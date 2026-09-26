import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { migrationManifest } from '../../scripts/release-check.mjs';
import { parseWranglerJsonc } from '../../scripts/d1-migration-check.mjs';
import {
  PRE_TIP, STAGING_DATABASE, STAGING_CONFIG, TIP, run, stagingConfig, verifySchema, verifySchemaGate,
} from '../../scripts/staging-d1-migration-check.mjs';

const { load } = createRequire(createRequire(import.meta.url).resolve('eslint/package.json'))('js-yaml');
const workflowText = readFileSync('.github/workflows/staging-d1-migrate.yml', 'utf8');
const rawConfig = readFileSync(STAGING_CONFIG, 'utf8');
const sourceDb = stagingConfig();
const dirs = [];
const temporary = () => { const dir = mkdtempSync(path.join(tmpdir(), 'staging-d1-')); dirs.push(dir); return dir; };
const write = (dir, name, data) => {
  const file = path.join(dir, name);
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
};
const result = (rows) => [{ success: true, results: rows }];
const names = migrationManifest(process.cwd(), execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
  .migrations.map((m) => m.name);
const schemaRows = () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE generated_meal_plans(id TEXT, household_id TEXT, creator_user_id TEXT, UNIQUE(id, household_id, creator_user_id)); CREATE TABLE recipes(id TEXT PRIMARY KEY)");
    db.exec(readFileSync('migrations/0039_meal_composition_v2.sql', 'utf8'));
    return db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('generated_meal_plan_compositions', 'generated_meal_plan_components', 'recipe_role_assignments', 'idx_generated_meal_plan_components_recipe', 'idx_generated_meal_plan_components_simple_food') ORDER BY name").all();
  } finally { db.close(); }
};

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('manual staging-only D1 migration gate', () => {
  it('pins the reviewed staging config, migration directory and excludes the production D1 ID', () => {
    expect(sourceDb.name).toBe(STAGING_DATABASE);
    const productionId = parseWranglerJsonc(readFileSync('wrangler.jsonc', 'utf8')).d1_databases[0].database_id;
    expect(sourceDb.id).not.toBe(productionId);
    for (const [from, to] of [
      ['frigo-db-staging-v3', 'frigo-db'], ['"ENVIRONMENT": "staging"', '"ENVIRONMENT": "production"'],
      ['"migrations_dir": "migrations"', '"migrations_dir": "elsewhere"'],
      [sourceDb.id, productionId],
    ]) expect(() => stagingConfig(rawConfig.replace(from, to))).toThrow(/Staging Wrangler config/);
    expect(() => stagingConfig(rawConfig.replace('"binding": "DB",', '"binding": "DB", "binding": "DB",')))
      .toThrow(/duplicate property/);
  });

  it('fails if the dispatch is not main before attempting network or D1 operations', async () => {
    const previous = process.env.GITHUB_REF;
    try {
      process.env.GITHUB_REF = 'refs/heads/not-main';
      await expect(run('gate', write(temporary(), 'receipt.json', {}))).rejects.toThrow(/main/);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_REF;
      else process.env.GITHUB_REF = previous;
    }
  });

  it('requires actual 0039 table/constraint/index schema and a clean repository schema gate', () => {
    const actual = schemaRows();
    expect(verifySchema(result(actual)).constraints).toBe('PASS');
    expect(verifySchemaGate(result([]))).toBe('PASS');
    expect(() => verifySchema(result(actual.slice(1)))).toThrow(/Missing T20/);
    const invalidOrdinal = actual.map((row) => ({ ...row, sql: row.sql.replace('BETWEEN 0 AND 7', 'BETWEEN 0 AND 99') }));
    expect(() => verifySchema(result(invalidOrdinal))).toThrow(/schema constraints/);
    const missingCascade = actual.map((row) => ({ ...row, sql: row.sql.replaceAll('ON DELETE CASCADE', '') }));
    expect(() => verifySchema(result(missingCascade))).toThrow(/schema constraints/);
    const incorrectIndex = actual.map((row) => ({ ...row, sql: row.name === 'idx_generated_meal_plan_components_simple_food'
      ? row.sql.replace('(plan_id, slot_id, simple_food_id)', '(plan_id, slot_id, recipe_id)') : row.sql }));
    expect(() => verifySchema(result(incorrectIndex))).toThrow(/partial unique index/);
    expect(() => verifySchemaGate(result([{ issue: 'missing_migration', detail: TIP }]))).toThrow(/drift/);
  });

  it('fails closed on ledger drift and pre-migration catalog counts before permitting a plan', async () => {
    const dir = temporary();
    const file = write(dir, 'receipt.json', { schema: { migrations: names.map((name) => ({ name })) },
      chain: [TIP], database: sourceDb, cloudflare: { accountAuthenticated: true } });
    const wrong = write(dir, 'wrong.json', result([{ name: '0040_unreviewed.sql' }]));
    await expect(run('pre-ledger', file, [wrong])).rejects.toThrow(/ledger/);
    const pre = write(dir, 'pre.json', result(names.slice(0, -1).map((name) => ({ name }))));
    await run('pre-ledger', file, [pre]);
    await run('bookmark', file, [write(dir, 'bookmark.json', { bookmark: 'test-bookmark' })]);
    const fk = write(dir, 'fk.json', result([]));
    const quick = write(dir, 'quick.json', result([{ quick_check: 'ok' }]));
    await expect(run('pre-health', file, [fk, quick, write(dir, 'counts.json', result([{ recipes: 71 }]))]))
      .rejects.toThrow(/500 recipes/);
    expect(readFileSync(file, 'utf8')).not.toContain('"preHealth"');
  });

  it('accepts a reviewed 0038→0039 plan or an exact already-applied 0039 ledger only', async () => {
    const dir = temporary();
    const file = write(dir, 'receipt.json', { schema: { migrations: names.map((name) => ({ name })) },
      chain: [TIP], database: sourceDb, cloudflare: { accountAuthenticated: true } });
    await run('pre-ledger', file, [write(dir, 'pre.json', result(names.slice(0, -1).map((name) => ({ name }))))]);
    expect(JSON.parse(readFileSync(file, 'utf8')).preLedger).toMatchObject({ mode: 'apply', tip: PRE_TIP });
    await run('pre-ledger', file, [write(dir, 'already.json', result(names.map((name) => ({ name }))))]);
    expect(JSON.parse(readFileSync(file, 'utf8')).preLedger).toMatchObject({ mode: 'certify', tip: TIP });
  });

  it('uses only a manual staging Environment and explicit staging config on every targeted D1 call', () => {
    const workflow = load(workflowText);
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.on.workflow_dispatch.inputs).toHaveProperty('confirm_staging_migration.default', false);
    expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(workflow.concurrency).toEqual({ group: 'frigo-deploy-staging', 'cancel-in-progress': false });
    expect(Object.keys(workflow.jobs)).toEqual(['certify']);
    expect(workflow.jobs.certify.environment).toBe('staging');
    expect(workflow.jobs.certify.if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.certify.if).toContain('inputs.confirm_staging_migration == true');
    const steps = workflow.jobs.certify.steps;
    const read = steps.findIndex((s) => s.name === 'Read and classify exact staging migration ledger');
    const apply = steps.findIndex((s) => s.name === "Apply only the certified 0039 chain via Wrangler's staging ledger");
    expect(read).toBeGreaterThan(0);
    expect(apply).toBeGreaterThan(read);
    expect(steps[apply - 1].name).toMatch(/Recheck current main/);
    const preflight = steps.slice(0, apply).map((s) => s.run || '').join('\n');
    expect(preflight).not.toMatch(/wrangler d1 migrations apply|wrangler deploy|--file\s/);
    for (const line of preflight.split('\n').filter((line) => /wrangler d1 execute/.test(line))) {
      expect(line).toMatch(/--command ("SELECT name FROM d1_migrations ORDER BY name"|"\$1") --json/);
    }
    for (const line of preflight.split('\n').filter((line) => /^\s*d1 "/.test(line))) {
      expect(line).toMatch(/^\s*d1 "(PRAGMA (foreign_key_check|quick_check)|\$\(node scripts\/staging-d1-migration-check\.mjs query baseline\))" > staging-pre-[a-z-]+\.json$/);
    }
    const d1Commands = steps.flatMap((s) => (s.run || '').split('\n').filter((line) => /wrangler d1 /.test(line)));
    expect(d1Commands.length).toBeGreaterThan(7);
    for (const command of d1Commands) {
      if (command.includes('d1 list --json')) continue;
      expect(command).toContain(STAGING_DATABASE);
      expect(command).toContain('--config wrangler.staging.jsonc');
      expect(command).not.toContain('frigo-db --');
    }
    expect(workflowText).not.toContain('environment: production');
    expect(workflowText).not.toContain('wrangler.jsonc --');
    expect(workflowText).not.toContain('time-travel restore');
    expect(workflowText).not.toContain('production-d1-migrate');
  });
});
