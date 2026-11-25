import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dir = new URL('../supabase/migrations/', import.meta.url);

test('no SQL file lives outside supabase/ (new changes go into supabase/migrations)', () => {
  const loose = readdirSync(root).filter((f) => f.endsWith('.sql'));
  assert.deepEqual(loose, []);
});

test('migrations are named YYYYMMDDHHMMSS_name.sql, the baseline first', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.equal(files[0], '20261125000000_baseline.sql');
  for (const f of files) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/, f);
  assert.equal(new Set(files.map((f) => f.slice(0, 14))).size, files.length, 'each time is used once');
});

test('the baseline has every table with row level security, and no personal data', () => {
  const sql = readFileSync(new URL('20261125000000_baseline.sql', dir), 'utf8');
  const tables = [...sql.matchAll(/^create table if not exists public\.(\w+)/gm)].map((m) => m[1]);
  const rls = new Set([...sql.matchAll(/^alter table public\.(\w+) enable row level security;/gm)].map((m) => m[1]));
  assert.ok(tables.length >= 70, 'all tables');
  for (const t of tables) assert.ok(rls.has(t), t + ' has row level security');
  assert.doesNotMatch(sql, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'no email address');
  assert.doesNotMatch(sql, /^(insert into|copy) /im, 'structure only, no rows (inserts inside functions are fine)');
});
