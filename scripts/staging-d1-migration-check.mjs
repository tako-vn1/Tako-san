import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  baselineQuery, classifyPreLedger, parseWranglerJsonc, validateMigrationCandidate,
  verifyBaselinePreserved, verifyCloudflareIdentity, verifyHealth, verifyMigrationPlan,
  verifyPostLedger,
} from './d1-migration-check.mjs';
import { requireSuccessfulCi } from './release-check.mjs';

export const STAGING_DATABASE = 'frigo-db-staging-v3';
export const STAGING_CONFIG = 'wrangler.staging.jsonc';
export const PRE_TIP = '0038_auth_onboarding_completion.sql';
export const TIP = '0039_meal_composition_v2.sql';
const TABLES = ['generated_meal_plan_compositions', 'generated_meal_plan_components', 'recipe_role_assignments'];
const INDEXES = ['idx_generated_meal_plan_components_recipe', 'idx_generated_meal_plan_components_simple_food'];

function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
function save(file, receipt) { writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`); }
function rows(statements, label) {
  if (!Array.isArray(statements) || statements.length !== 1 || statements[0]?.success !== true ||
      !Array.isArray(statements[0].results)) throw new Error(`${label}: expected one successful D1 result`);
  return statements[0].results;
}

export function stagingConfig(text = readFileSync(STAGING_CONFIG, 'utf8')) {
  const config = parseWranglerJsonc(text, STAGING_CONFIG);
  const binding = config.d1_databases?.[0];
  const production = parseWranglerJsonc(readFileSync('wrangler.jsonc', 'utf8'), 'wrangler.jsonc');
  if (config.name !== 'frigo-staging' || config.vars?.ENVIRONMENT !== 'staging' ||
      config.d1_databases?.length !== 1 || binding?.binding !== 'DB' ||
      binding.database_name !== STAGING_DATABASE || binding.migrations_dir !== 'migrations' ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(binding.database_id ?? '') ||
      production.d1_databases?.some((db) => db.database_id === binding.database_id)) {
    throw new Error('Staging Wrangler config identity or migration directory differs from the pinned target');
  }
  return { name: binding.database_name, id: binding.database_id };
}

async function exactMainCi(sha) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !process.env.GH_TOKEN) {
    throw new Error('Repository-scoped Actions read token is required');
  }
  const query = new URLSearchParams({ branch: 'main', event: 'push', head_sha: sha, per_page: '100' });
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?${query}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Hosted CI lookup failed: HTTP ${response.status}`);
  return requireSuccessfulCi((await response.json()).workflow_runs, { sha, repository });
}

export async function gate(ref) {
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Dispatch must run from main');
  const candidate = validateMigrationCandidate({ ref, expectedPreTip: PRE_TIP, migration: TIP });
  if (candidate.sha !== candidate.mainSha) throw new Error('Migration ref must equal current main, not an ancestor');
  const database = stagingConfig();
  const ci = await exactMainCi(candidate.sha);
  return { sha: candidate.sha, schema: candidate.schema, chain: candidate.chain,
    database, ci, checkedAt: new Date().toISOString() };
}

export function verifySchema(statements) {
  const found = rows(statements, 'T20 schema');
  const names = new Set(found.map((row) => row.name));
  for (const name of [...TABLES, ...INDEXES]) {
    if (!names.has(name)) throw new Error(`Missing T20 schema object ${name}`);
  }
  if (found.length !== TABLES.length + INDEXES.length) throw new Error('Unexpected T20 schema objects');
  const sql = (name) => found.find((row) => row.name === name)?.sql ?? '';
  const composition = sql(TABLES[0]);
  const component = sql(TABLES[1]);
  const roles = sql(TABLES[2]);
  if (!/PRIMARY KEY\s*\(plan_id, slot_id\)/i.test(composition) ||
      !/FOREIGN KEY\s*\(plan_id, household_id, creator_user_id\)/i.test(composition) ||
      !/CHECK\s*\(mode IN\s*\('manual', 'assisted', 'auto'\)\)/i.test(composition) ||
      !/PRIMARY KEY\s*\(plan_id, id\)/i.test(component) ||
      !/UNIQUE\s*\(plan_id, slot_id, ordinal\)/i.test(component) ||
      !/FOREIGN KEY\s*\(plan_id, slot_id\)/i.test(component) ||
      !/ordinal BETWEEN 0 AND 7/i.test(component) ||
      !/kind = 'recipe' AND recipe_id IS NOT NULL AND simple_food_id IS NULL/i.test(component) ||
      !/role IN\s*\('main', 'side', 'vegetable', 'soup', 'staple', 'dessert', 'simple_food'\)/i.test(component) ||
      !/provenance IN\s*\('legacy_v1', 'manual', 'assisted', 'auto'\)/i.test(component) ||
      /REFERENCES\s+recipes\b/i.test(component) ||
      !/PRIMARY KEY\s*\(recipe_id, role, source\)/i.test(roles) ||
      !/REFERENCES recipes\(id\)/i.test(roles) ||
      !/source = 'ai'/i.test(roles) || !/source <> 'reviewed'/i.test(roles)) {
    throw new Error('T20 schema constraints do not match the reviewed 0039 contract');
  }
  for (const name of INDEXES) {
    if (!/CREATE UNIQUE INDEX/i.test(sql(name)) || !/WHERE (recipe_id|simple_food_id) IS NOT NULL/i.test(sql(name))) {
      throw new Error(`T20 partial unique index ${name} is invalid`);
    }
  }
  return { objects: [...TABLES, ...INDEXES], constraints: 'PASS' };
}

export function verifySchemaGate(statements) {
  if (rows(statements, 'Repository D1 schema gate').length !== 0) throw new Error('Repository D1 schema gate found drift');
  return 'PASS';
}

export async function run(command, file, args = []) {
  if (command === 'query') {
    if (file === 'baseline') return baselineQuery();
    if (file === 'schema') {
      return `SELECT type, name, sql FROM sqlite_master WHERE name IN (${[...TABLES, ...INDEXES]
        .map((name) => `'${name}'`).join(', ')}) ORDER BY name`;
    }
    throw new Error('Unknown read-only query');
  }
  if (command === 'gate') { const receipt = await gate(process.env.MIGRATION_REF); save(file, receipt); return receipt; }
  const receipt = readJson(file);
  if (command === 'recheck') {
    const current = await gate(receipt.sha);
    if (JSON.stringify(current.schema) !== JSON.stringify(receipt.schema) ||
        current.database.id !== receipt.database.id) throw new Error('Candidate changed after dispatch');
    receipt.ci = current.ci;
  } else if (command === 'identity') {
    const expected = stagingConfig();
    if (expected.id !== receipt.database.id || expected.name !== receipt.database.name)
      throw new Error('Staging database identity changed');
    receipt.cloudflare = verifyCloudflareIdentity({ list: readJson(args[0]), info: readJson(args[1]), expected });
  } else if (command === 'pre-ledger') {
    if (!receipt.cloudflare) throw new Error('Remote staging identity not certified');
    receipt.preLedger = classifyPreLedger({ schema: receipt.schema, chain: receipt.chain }, readJson(args[0]));
    if (receipt.preLedger.tip !== (receipt.preLedger.mode === 'apply' ? PRE_TIP : TIP))
      throw new Error('Staging ledger tip is not the expected 0038 or 0039');
  } else if (command === 'bookmark') {
    if (!receipt.preLedger) throw new Error('Staging ledger not certified');
    const bookmark = readJson(args[0])?.bookmark;
    if (typeof bookmark !== 'string' || !bookmark) throw new Error('No D1 Time Travel bookmark returned');
    receipt.timeTravel = { bookmark, capturedAt: new Date().toISOString() };
  } else if (command === 'pre-health') {
    if (!receipt.timeTravel) throw new Error('Time Travel bookmark not captured');
    receipt.preHealth = verifyHealth({ foreignKeys: readJson(args[0]), quickCheck: readJson(args[1]) });
    const baseline = rows(readJson(args[2]), 'Pre-migration baseline');
    if (baseline.length !== 1 || baseline[0]?.recipes !== 500) throw new Error('Staging D1 does not contain the reviewed 500 recipes');
    receipt.preBaseline = baseline[0];
  } else if (command === 'plan') {
    if (!receipt.preHealth) throw new Error('Pre-migration health missing');
    receipt.plan = verifyMigrationPlan(readFileSync(args[0], 'utf8'), {
      migration: TIP, chain: receipt.chain, mode: receipt.preLedger.mode,
    });
  } else if (command === 'post') {
    if (!receipt.plan) throw new Error('Migration plan was not certified');
    receipt.postLedger = verifyPostLedger({ schema: receipt.schema }, readJson(args[0]));
    receipt.postHealth = verifyHealth({ foreignKeys: readJson(args[1]), quickCheck: readJson(args[2]) });
    const postBaseline = readJson(args[3]);
    const preBaseline = [{ success: true, results: [receipt.preBaseline] }];
    receipt.aggregateDrift = verifyBaselinePreserved(preBaseline, postBaseline).drift;
    receipt.schemaCheck = verifySchema(readJson(args[4]));
    receipt.schemaGate = verifySchemaGate(readJson(args[5]));
    receipt.status = 'STAGING_0039_CERTIFIED';
  } else throw new Error('Unknown staging migration check');
  save(file, receipt);
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, file, ...args] = process.argv.slice(2);
  run(command, file, args).then((value) => {
    if (command === 'query') process.stdout.write(value);
    else console.log(`Staging D1 ${command}: ${value.status ?? 'PASS'}`);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
