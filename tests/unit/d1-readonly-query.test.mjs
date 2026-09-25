import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReadOnlyProof } from '../../scripts/d1-readonly-query.mjs';
import { catalogQuery, loadRuntimeCatalogPipeline } from '../../scripts/d1-migration-check.mjs';
import { renderSchemaGateCommand } from '../../scripts/d1-schema-gate.mjs';

function fixture(name, sql, responses = []) {
  const inputs = {
    schema: ['schema-gate.sql', 'schema-proof.json'],
    catalog: ['catalog.sql', 'catalog.json'],
    'runtime-catalog': ['runtime-catalog.sql', 'runtime-catalog.json'],
  };
  const [input, output] = inputs[name];
  const cwd = mkdtempSync(path.join(tmpdir(), 'd1-readonly-'));
  writeFileSync(path.join(cwd, input), sql);
  const calls = [];
  const execute = (cli, args, options) => {
    calls.push({ cli, args, options });
    return responses.length ? responses[calls.length - 1] : JSON.stringify([{ success: true, results: [] }]);
  };
  return {
    cwd, calls, execute,
    output: () => JSON.parse(readFileSync(path.join(cwd, output))),
    hasOutput: () => existsSync(path.join(cwd, output)),
    close: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

describe('read-only production D1 query proofs', () => {
  it('queries the remote API and preserves one complete result per generated statement', async () => {
    const pipeline = await loadRuntimeCatalogPipeline();
    try {
      for (const [name, sql, count] of [
        ['schema', renderSchemaGateCommand(), 1],
        ['catalog', catalogQuery(), 2],
        ['runtime-catalog', pipeline.queries.join(';\n'), 5],
      ]) {
        const f = fixture(name, sql);
        try {
          expect(runReadOnlyProof(name, f)).toHaveLength(count);
          expect(f.output()).toHaveLength(count);
          expect(f.calls).toHaveLength(count);
          expect(f.calls.every(({ cli, args, options }) =>
            cli === 'pnpm' && args.join(' ').startsWith('wrangler d1 execute frigo-db --remote --yes --json --command ') &&
            !args.includes('--file') && options.stdio[0] === 'ignore')).toBe(true);
          expect(f.calls.map(({ args }) => args.at(-1))).toEqual(sql.split(';').map((s) => s.trim()).filter(Boolean));
        } finally {
          f.close();
        }
      }
    } finally {
      await pipeline.close();
    }
  });

  it.each([
    ['schema', 'SELECT 1'],
    ['schema', 'WITH x AS (SELECT 1) DELETE FROM recipes'],
    ['schema', 'WITH x AS (SELECT 1) SELECT * FROM pragma_wal_checkpoint'],
    ['catalog', 'SELECT 1'],
    ['catalog', 'SELECT 1; DELETE FROM recipes'],
    ['runtime-catalog', Array(4).fill('SELECT 1').join(';')],
    ['runtime-catalog', 'SELECT 1; SELECT 2; SELECT 3; SELECT 4; PRAGMA quick_check'],
  ])('rejects unexpected or unsafe %s SQL before any remote request', (name, sql) => {
    const f = fixture(name, sql);
    try {
      expect(() => runReadOnlyProof(name, f)).toThrow();
      expect(f.calls).toHaveLength(0);
      expect(f.hasOutput()).toBe(false);
    } finally {
      f.close();
    }
  });

  it.each([
    '', 'not json', '{}', '[]', '[{"success":true}]',
    '[{"success":false,"results":[]}]',
    '[{"success":true,"results":[]},{"success":true,"results":[]}]',
    '[{"success":true,"results":[{"Total queries executed":1}]}]',
  ])('rejects missing, failed, or import-style schema query evidence', (response) => {
    const f = fixture('schema', renderSchemaGateCommand(), [response]);
    try {
      expect(() => runReadOnlyProof('schema', f)).toThrow();
      expect(f.hasOutput()).toBe(false);
    } finally {
      f.close();
    }
  });

  it('does not write a partial catalog receipt after a later query fails', () => {
    const f = fixture('catalog', catalogQuery(), [
      '[{"success":true,"results":[]}]', '[{"success":false,"results":[]}]',
    ]);
    try {
      expect(() => runReadOnlyProof('catalog', f)).toThrow();
      expect(f.calls).toHaveLength(2);
      expect(f.hasOutput()).toBe(false);
    } finally {
      f.close();
    }
  });
});
