import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../.github/workflows/', import.meta.url);

// "version: latest" makes setup actions ask GitHub's API for the newest
// release; that call is rate limited and failed the nightly backup.
test('workflows pin the Supabase CLI to a fixed version', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));
  let seen = 0;
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    const uses = text.split('\n').map((l, i) => [l, i]).filter(([l]) => l.includes('supabase/setup-cli'));
    for (const [, i] of uses) {
      seen++;
      const block = text.split('\n').slice(i, i + 6).filter((l) => !l.trim().startsWith('#')).join('\n');
      const m = block.match(/version:\s*([^\s#]+)/);
      assert.ok(m, `${f}: setup-cli without a version`);
      assert.match(m[1], /^\d+\.\d+\.\d+$/, `${f}: setup-cli version must be fixed, got ${m[1]}`);
    }
  }
  assert.ok(seen >= 2, 'backup and migrate both set up the CLI');
});
