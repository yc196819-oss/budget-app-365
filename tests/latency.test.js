const test = require('node:test');
const assert = require('node:assert/strict');
const { measure } = require('../server/latency');

test('the middle of five tries, with the fastest and the slowest', async () => {
  const ticks = [0, 120, 200, 330, 400, 900, 1000, 1110, 1200, 1300];
  let i = 0;
  const r = await measure(async () => {}, 5, () => ticks[i++]);
  assert.deepEqual(r, { ms: 120, min: 100, max: 500, tries: 5 });
});

test('a failing call gives no number rather than a wrong one', async () => {
  assert.equal(await measure(async () => { throw new Error('down'); }), null);
});
