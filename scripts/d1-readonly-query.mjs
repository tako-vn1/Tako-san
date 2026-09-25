import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const proofs = {
  schema: { input: 'schema-gate.sql', output: 'schema-proof.json', count: 1, start: /^WITH\b/i },
  catalog: { input: 'catalog.sql', output: 'catalog.json', count: 2, start: /^SELECT\b/i },
  'runtime-catalog': { input: 'runtime-catalog.sql', output: 'runtime-catalog.json', count: 5, start: /^SELECT\b/i },
};

export function runReadOnlyProof(name, { cwd = process.cwd(), execute = execFileSync } = {}) {
  const proof = proofs[name];
  if (!proof) throw new Error('Unknown read-only D1 proof');
  const sql = readFileSync(path.join(cwd, proof.input), 'utf8');
  const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
  if (statements.length !== proof.count) throw new Error(`${name} statement count changed`);

  for (const statement of statements) {
    const guarded = statement.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
    if (!proof.start.test(guarded.trim()) ||
      /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|REINDEX|ATTACH|DETACH|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|load_extension|writefile|readfile)\b/i.test(guarded)) {
      throw new Error(`${name} contains non-read-only SQL`);
    }
    for (const pragma of guarded.match(/\bpragma_\w+/gi) || []) {
      if (!['pragma_foreign_key_check', 'pragma_table_info'].includes(pragma.toLowerCase())) {
        throw new Error(`${name} contains an unapproved PRAGMA function`);
      }
    }
  }

  const results = [];
  for (const [index, statement] of statements.entries()) {
    let result;
    try {
      result = JSON.parse(execute('pnpm', [
        'wrangler', 'd1', 'execute', 'frigo-db', '--remote', '--yes', '--json', '--command', statement,
      ], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch {
      throw new Error(`${name} read-only query ${index + 1} failed`);
    }
    if (!Array.isArray(result) || result.length !== 1 || result[0]?.success !== true ||
      !Array.isArray(result[0].results)) {
      throw new Error(`${name} read-only query ${index + 1} returned incomplete evidence`);
    }
    if (name === 'schema' && result[0].results.length !== 0) {
      throw new Error('Schema proof reported issues');
    }
    results.push(result[0]);
  }
  writeFileSync(path.join(cwd, proof.output), JSON.stringify(results));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Expected exactly one read-only D1 proof name');
  runReadOnlyProof(process.argv[2]);
}
