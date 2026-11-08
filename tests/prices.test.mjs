import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { CHAINS, probeOne, probeAll } = createRequire(import.meta.url)('../server/prices.js');

test('every chain site is https and has a Hebrew name', () => {
  assert.ok(CHAINS.length >= 8);
  for (const c of CHAINS) { assert.match(c.url, /^https:\/\//); assert.match(c.name, /[א-ת]/); }
});

test('a site that answers, one that refuses, one that is down, one that hangs', async () => {
  const fake = async (url, { signal }) => {
    if (url.includes('a.test')) return { status: 200 };
    if (url.includes('b.test')) return { status: 403 };
    if (url.includes('c.test')) { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }
    return new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  };
  const out = await probeAll(fake, [
    { key: 'a', name: 'א', url: 'https://a.test/' }, { key: 'b', name: 'ב', url: 'https://b.test/' },
    { key: 'c', name: 'ג', url: 'https://c.test/' }, { key: 'd', name: 'ד', url: 'https://d.test/' }
  ], 50);
  assert.deepEqual(out.map((r) => [r.key, r.ok, r.status, r.error || '']), [['a', true, 200, ''], ['b', false, 403, ''], ['c', false, 0, 'ENOTFOUND'], ['d', false, 0, 'timeout']]);
  assert.equal((await probeOne(CHAINS[0], async () => ({ status: 301 }))).ok, true);
});
