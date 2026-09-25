import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogQuery, loadRuntimeCatalogPipeline } from '../../scripts/d1-migration-check.mjs';
import { renderSchemaGateCommand } from '../../scripts/d1-schema-gate.mjs';

// Reuse the YAML parser owned by the locked ESLint dependency, without adding tooling.
const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('eslint/package.json'))('js-yaml');
const source = readFileSync('.github/workflows/production-certify.yml', 'utf8');
const workflow = () => load(source);
const hash = (value) => createHash('sha256').update(value).digest('hex');

// These fingerprints pin the entire audited shell/inline-JS surface, not just command prefixes.
// Updating one requires reviewing its execution path; mutation tests exercise that boundary.
const reviewedCommands = {
  'gate: Require immutable current main and exact-SHA CI': '4512f8e870d2c4cc649cd3443c28161ebd7a728b9d6c967e57031ebd74c2085a',
  'certify: Install locked certification tooling': 'f733afb2da73a36bd48778fd7502436e384741ad191367d97182afc4909130a5',
  'certify: Recheck exact main after Environment approval': 'aa81ef73b471de6553f8479ec179a3534902e91dbd0e24374184626b80ecda5f',
  'certify: Generate and guard reviewed read-only SQL': '9ca685fe87015090bafaf8544ff961d42e5efed2b63377357f3f241b4f9b634a',
  'certify: Certify live production identity and capture rollback baseline (read-only)': '34c78ea996af23f60c9ee0c16186f26752cf705dcaab9ceb3668609076d4c3f9',
  'certify: Certify schema, ledger, catalog and integrity (read-only)': 'e2bcb4088e661d5b00016db447ce9062016e1beb7a6f9ee68035423af1183f1f',
  'certify: Require unchanged production baseline': '7152c73d337451a8dd765b025786184cc168b8b1d29a49bd4a0f21d1771c7fac',
  'certify: Recheck exact main and finalize sanitized certification receipt': '238204516ee89aa6389b3241d476c7c6293ee9903a89796439f6311d5efc131b',
};
const reviewedSchemaGate = {
  'scripts/d1-readonly-query.mjs': '3567c70842edaca5deae7828454548983fd6fff6aae05ae1becf271bee2888c2',
  'scripts/d1-schema-gate.sh': 'e48596c6001f7fc20bb0d03213553f0bfe7575585bc02144d432f0a11cccb625',
  'scripts/d1-schema-gate.mjs': 'e443766807873c458581c82049cef1b0967dff2493b61804e1ae7f6bb6e7128a',
  'scripts/d1-schema-gate.sql': 'c6d7da1c5f5cb9b16e7738242723cf571cbf426f8aeb7c68ba01e37b2ba2888c',
};
const step = (name) => workflow().jobs.certify.steps.find((s) => s.name === name);
const inline = (script) => script.split("<<'JS'\n")[1].split('\nJS')[0];

function assertReadOnlySurface(candidate) {
  expect(Object.keys(candidate).sort()).toEqual(['concurrency', 'jobs', 'name', 'on', 'permissions']);
  expect(candidate.on).toEqual({ workflow_dispatch: { inputs: {
    ref: { description: 'Full immutable current-main SHA to certify (no deployment)', type: 'string', required: true },
    hardened_sha: { description: 'Exact final hardening SHA approved by the release owner (same policy as Deploy)', type: 'string', required: true },
    confirm_read_only_certification: { description: 'Confirm production read-only certification only', type: 'boolean', required: true, default: false },
  } } });
  expect(candidate.permissions).toEqual({ contents: 'read', actions: 'read' });
  expect(candidate.concurrency).toEqual({ group: 'frigo-deploy-production', 'cancel-in-progress': false });
  expect(Object.keys(candidate.jobs)).toEqual(['gate', 'certify']);
  const { steps: gateSteps, ...gate } = candidate.jobs.gate;
  const { steps: certifySteps, ...certify } = candidate.jobs.certify;
  expect(gate).toEqual({
    if: "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.confirm_read_only_certification == true",
    'runs-on': 'ubuntu-latest', outputs: { certify_sha: '${{ steps.gate.outputs.deploy_sha }}' },
  });
  expect(certify).toEqual({ needs: 'gate', 'runs-on': 'ubuntu-latest', environment: 'production', 'timeout-minutes': 20 });
  const commands = {};
  const actions = [];
  for (const [job, steps] of [['gate', gateSteps], ['certify', certifySteps]]) {
    for (const s of steps) {
      expect(Object.keys(s).every((key) => ['name', 'id', 'run', 'env', 'uses', 'with', 'if'].includes(key))).toBe(true);
      expect(Boolean(s.run)).not.toBe(Boolean(s.uses));
      if (s.run) {
        expect(s.if).toBeUndefined();
        expect(s.with).toBeUndefined();
        const key = `${job}: ${s.name}`;
        expect(commands[key]).toBeUndefined();
        commands[key] = hash(s.run);
        const allowedEnv = job === 'gate' ? {
          GH_TOKEN: '${{ github.token }}', RELEASE_REF: '${{ inputs.ref }}', HARDENED_SHA: '${{ inputs.hardened_sha }}',
          RELEASE_ENVIRONMENT: 'production', RECIPE_CATALOG_MODE: 'static', RECIPE_CATALOG_D1_CANARY_PERCENT: '0',
        } : s.name.startsWith('Recheck') ? { GH_TOKEN: '${{ github.token }}' }
          : /^(Certify live|Certify schema|Require unchanged)/.test(s.name) ? {
            CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
            CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}', WRANGLER_SEND_METRICS: 'false',
          } : undefined;
        expect(s.env).toEqual(allowedEnv);
        expect(s.id).toBe(job === 'gate' ? 'gate' : undefined);
      } else {
        expect(s.env).toBeUndefined();
        expect(s.id).toBeUndefined();
        actions.push({ job, ...s });
      }
    }
  }
  expect(commands).toEqual(reviewedCommands);
  expect(actions).toEqual([
    { job: 'gate', uses: 'actions/checkout@v4', with: { ref: 'main', 'fetch-depth': 0, 'persist-credentials': false } },
    { job: 'gate', uses: 'actions/setup-node@v4', with: { 'node-version': 22 } },
    { job: 'gate', uses: 'actions/upload-artifact@v4', with: { name: 'production-certification-candidate-${{ github.run_id }}-${{ github.run_attempt }}', path: 'release-manifest.json', 'if-no-files-found': 'error', 'retention-days': 90 } },
    { job: 'certify', uses: 'actions/checkout@v4', with: { ref: '${{ needs.gate.outputs.certify_sha }}', 'fetch-depth': 0, 'persist-credentials': false } },
    { job: 'certify', uses: 'actions/download-artifact@v4', with: { name: 'production-certification-candidate-${{ github.run_id }}-${{ github.run_attempt }}' } },
    { job: 'certify', uses: 'actions/setup-node@v4', with: { 'node-version': 22 } },
    { job: 'certify', uses: 'pnpm/action-setup@v4', with: { version: 10 } },
    { job: 'certify', name: 'Save sanitized receipt (PASS requires certification.result)', if: 'always()', uses: 'actions/upload-artifact@v4', with: { name: 'production-certification-${{ github.run_id }}-${{ github.run_attempt }}', path: 'release-manifest.json', 'if-no-files-found': 'error', 'retention-days': 90 } },
  ]);
  expect(certifySteps.map((s) => s.name || s.uses)).toEqual([
    'actions/checkout@v4', 'actions/download-artifact@v4', 'actions/setup-node@v4', 'pnpm/action-setup@v4',
    ...Object.keys(reviewedCommands).filter((k) => k.startsWith('certify: ')).map((k) => k.slice(9)),
    'Save sanitized receipt (PASS requires certification.result)',
  ]);
}

function executeInline(script, files, env = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'production-certify-'));
  try {
    for (const [name, value] of Object.entries(files)) writeFileSync(path.join(cwd, name), typeof value === 'string' ? value : JSON.stringify(value));
    execFileSync(process.execPath, ['--input-type=module'], { cwd, input: script, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    return files['release-manifest.json'] ? JSON.parse(readFileSync(path.join(cwd, 'release-manifest.json'), 'utf8')) : null;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('production certification workflow safety', () => {
  it('allows only manual exact-main certification behind the production Environment', () => {
    assertReadOnlySurface(workflow());
  });

  it('pins the reviewed schema gate transitive shell/SQL surface', () => {
    for (const [file, expected] of Object.entries(reviewedSchemaGate)) expect(hash(readFileSync(file))).toBe(expected);
    const schema = renderSchemaGateCommand();
    expect(schema).toMatch(/^WITH\b/);
    expect(schema).toContain('SELECT');
  });

  it.each([
    'pnpm wrangler deploy', 'pnpm wrangler d1 migrations apply frigo-db --remote',
    'pnpm wrangler secret put RELEASE_VERIFY_TOKEN', 'pnpm wrangler secret delete RELEASE_VERIFY_TOKEN',
    'pnpm wrangler versions deploy abc@100%', 'node scripts/cloudflare-worker-rollback.mjs abc',
    'curl -X POST https://api.cloudflare.com/client/v4/accounts/example',
    'pnpm wrangler d1 execute frigo-db --remote --command "DELETE FROM recipes"',
    'eval "$UNREVIEWED_COMMAND"', 'bash unreviewed-script.sh',
  ])('rejects a new executable command: %s', (command) => {
    const candidate = workflow();
    candidate.jobs.certify.steps.find((s) => s.run).run += `\n${command}\n`;
    expect(() => assertReadOnlySurface(candidate)).toThrow();
  });

  it.each([
    (w) => { w.on.push = {}; },
    (w) => { w.permissions.actions = 'write'; },
    (w) => { w.jobs.certify.environment = 'staging'; },
    (w) => { w.jobs.certify.env = { BASH_ENV: './unreviewed.sh' }; },
    (w) => { w.jobs.gate.if = 'always()'; },
    (w) => { w.jobs.certify.steps[0].with.ref = 'main'; },
    (w) => { w.jobs.certify.steps.at(-1).with.path = '*.json'; },
    (w) => { w.jobs.certify.steps.push({ uses: 'cloudflare/wrangler-action@v3' }); },
    (w) => { w.jobs.certify.steps.find((s) => s.run).env = { CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}' }; },
  ])('rejects weakened workflow boundaries %#', (mutate) => {
    const candidate = workflow();
    mutate(candidate);
    expect(() => assertReadOnlySurface(candidate)).toThrow();
  });

  it('uses the same production certification verifiers and only fixed integrity PRAGMAs', () => {
    const commands = step('Certify schema, ledger, catalog and integrity (read-only)').run;
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    for (const command of [
      'bash scripts/d1-schema-gate.sh remote',
      'node scripts/release-check.mjs schema release-manifest.json migration-ledger.json',
      'node scripts/d1-migration-check.mjs runtime-catalog release-manifest.json runtime-catalog.json',
      'node scripts/d1-migration-check.mjs release-certify release-manifest.json catalog.json foreign-keys.json quick-check.json',
    ]) {
      expect(commands).toContain(command);
      expect(deploy).toContain(command);
    }
    for (const proof of ['schema', 'catalog', 'runtime-catalog']) {
      expect(commands).toContain(`node scripts/d1-readonly-query.mjs ${proof}`);
    }
    expect([...commands.matchAll(/--command "([^"]+)"/g)].map((m) => m[1])).toEqual([
      'SELECT name FROM d1_migrations ORDER BY name', 'PRAGMA foreign_key_check', 'PRAGMA quick_check',
    ]);
    expect(commands).not.toMatch(/wrangler d1 execute [^\n]*--file\b/);
    expect(deploy).toContain('node scripts/d1-readonly-query.mjs runtime-catalog');
    expect(deploy).not.toContain('--file runtime-catalog.sql');
  });

  it('rejects absent or malformed schema proof, not just reported schema issues', () => {
    const commands = step('Certify schema, ledger, catalog and integrity (read-only)').run;
    const script = commands.match(/node --input-type=module -e '(.+)'/)[1];
    executeInline(script, { 'schema-proof.json': [{ success: true, results: [] }] });
    for (const proof of [[], {}, [{ success: true }], [{ success: false, results: [] }], [{ success: true, results: [{ issue: 'missing_table' }] }]]) {
      expect(() => executeInline(script, { 'schema-proof.json': proof })).toThrow();
    }
  });

  it('does not certify missing, contradictory or partial evidence', () => {
    const script = inline(step('Recheck exact main and finalize sanitized certification receipt').run);
    const valid = {
      repository: 'fixture/Frigo', environment: 'production', productionBaseline: { bindingVerified: true },
      catalog: { releaseComplete: true }, runtimeCatalog: { actualRecipes: 500 }, health: { quickCheck: 'ok' },
    };
    const env = { GITHUB_REPOSITORY: valid.repository };
    expect(executeInline(script, { 'release-manifest.json': valid }, env).certification).toMatchObject({ result: 'PASS', readOnly: true, productionMutations: [] });
    for (const key of Object.keys(valid)) {
      const incomplete = { ...valid };
      delete incomplete[key];
      expect(() => executeInline(script, { 'release-manifest.json': incomplete }, env)).toThrow();
    }
    expect(() => executeInline(script, { 'release-manifest.json': { ...valid, environment: 'staging' } }, env)).toThrow();
  });

  it('allows current generated catalog, runtime and SELECT-only schema CTE queries', async () => {
    const pipeline = await loadRuntimeCatalogPipeline();
    try {
      executeInline(inline(step('Generate and guard reviewed read-only SQL').run), {
        'catalog.sql': catalogQuery(), 'runtime-catalog.sql': pipeline.queries.join(';\n'),
        'schema-gate.sql': renderSchemaGateCommand(),
      });
    } finally {
      await pipeline.close();
    }
  });

  it.each([
    'INSERT INTO recipes VALUES (1)', 'UPDATE recipes SET title = 1', 'DELETE FROM recipes',
    'REPLACE INTO recipes VALUES (1)', 'CREATE TABLE example(id)', 'DROP TABLE recipes',
    'ALTER TABLE recipes ADD COLUMN example', 'VACUUM', 'REINDEX', 'PRAGMA writable_schema=ON',
    'SELECT load_extension(1)', 'SELECT writefile(1)', 'SELECT * FROM pragma_wal_checkpoint',
    'SELECT 1; DELETE FROM recipes', 'WITH x AS (SELECT 1) DELETE FROM recipes',
  ])('rejects generated unsafe SQL: %s', (sql) => {
    const script = inline(step('Generate and guard reviewed read-only SQL').run);
    for (const file of ['catalog.sql', 'runtime-catalog.sql', 'schema-gate.sql']) {
      const files = {
        'catalog.sql': 'SELECT 1; SELECT 2',
        'runtime-catalog.sql': Array(5).fill('SELECT 1').join(';'),
        'schema-gate.sql': 'WITH x AS (SELECT 1) SELECT * FROM x',
      };
      files[file] = file === 'catalog.sql' ? `SELECT 1; ${sql}` : file === 'runtime-catalog.sql' ? `${Array(4).fill('SELECT 1').join(';')}; ${sql}` : sql;
      expect(() => executeInline(script, files)).toThrow();
    }
  });

  it('projects only safe Worker metadata, never raw bindings or credentials', () => {
    const script = inline(step('Certify live production identity and capture rollback baseline (read-only)').run);
    const files = {
      'release-manifest.json': { previousDeployment: { versionId: 'version-a' } },
      'previous-version.json': { resources: { bindings: [
        { type: 'plain_text', name: 'ENVIRONMENT', text: 'production' },
        { type: 'plain_text', name: 'GIT_COMMIT', text: 'a'.repeat(40) },
        { type: 'plain_text', name: 'PRIVATE_FIXTURE', text: 'not-for-receipts' },
        { type: 'secret_text', name: 'RELEASE_VERIFY_TOKEN', text: 'not-for-receipts' },
      ] } },
    };
    const receipt = executeInline(script, files, { CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) });
    expect(receipt.productionBaseline).toEqual({ accountIdentifierSha256: hash('b'.repeat(32)), worker: 'frigo', environment: 'production', versionId: 'version-a', deployedSha: 'a'.repeat(40), bindingVerified: true });
    expect(JSON.stringify(receipt)).not.toContain('not-for-receipts');
    expect(JSON.stringify(receipt)).not.toContain('b'.repeat(32));
    expect(receipt.productionAuthority).toBe('UNKNOWN_RELEASE_SECRET_NOT_AVAILABLE');
    files['previous-version.json'].resources.bindings[0].text = 'staging';
    expect(() => executeInline(script, files, { CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) })).toThrow();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['short', 'a'.repeat(7)],
    ['uppercase', 'A'.repeat(40)],
    ['non-hex', 'g'.repeat(40)],
    ['39 characters', 'a'.repeat(39)],
    ['41 characters', 'a'.repeat(41)],
  ])('fails closed for %s production Worker GIT_COMMIT', (_label, gitCommit) => {
    const script = inline(step('Certify live production identity and capture rollback baseline (read-only)').run);
    const bindings = [{ type: 'plain_text', name: 'ENVIRONMENT', text: 'production' }];
    if (gitCommit !== undefined) bindings.push({ type: 'plain_text', name: 'GIT_COMMIT', text: gitCommit });
    const files = {
      'release-manifest.json': { previousDeployment: { versionId: 'version-a' } },
      'previous-version.json': { resources: { bindings } },
    };
    expect(() => executeInline(script, files, { CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) })).toThrow(/GIT_COMMIT/);
  });
});
