const test = require('node:test');
const assert = require('node:assert/strict');
const logos = require('../server/chainLogos.js');

const fake = (status, type, body) => async () => ({ ok: status === 200, status, headers: { get: () => type }, arrayBuffer: async () => Buffer.from(body) });

test('chain logos: only an image of a known kind and size is served', () => {
  assert.equal(logos.acceptable('image/png', 1000), 'image/png');
  assert.equal(logos.acceptable('image/svg+xml; charset=utf-8', 1000), 'image/svg+xml');
  assert.equal(logos.acceptable('text/html', 1000), null);
  assert.equal(logos.acceptable('image/png', 0), null);
  assert.equal(logos.acceptable('image/png', 5 * 1024 * 1024), null, 'too big');
});

test('chain logos: fetched once from the fixed list, kept; unknown keys and failures are not served', async () => {
  logos._cache.clear();
  let calls = 0;
  const ok = async (...a) => { calls++; return fake(200, 'image/png', 'PNGDATA')(...a); };
  const a = await logos.getLogo('rami-levy', { fetchImpl: ok, now: 1000 });
  assert.equal(a.type, 'image/png');
  await logos.getLogo('rami-levy', { fetchImpl: ok, now: 2000 });
  assert.equal(calls, 1, 'kept, not fetched again');
  assert.equal(await logos.getLogo('not-a-chain', { fetchImpl: ok }), null, 'only the fixed list');
  assert.equal(await logos.getLogo('shufersal', { fetchImpl: fake(200, 'text/html', '<html>') }), null, 'a page is not a logo');
  assert.equal(await logos.getLogo('victory', { fetchImpl: fake(403, 'image/png', 'x') }), null);
  // An SVG served as text is still a logo when it is one.
  const svg = await logos.getLogo('osher-ad', { fetchImpl: fake(200, 'text/plain', '<svg xmlns="http://www.w3.org/2000/svg"></svg>') });
  assert.equal(svg.type, 'image/svg+xml');
});
