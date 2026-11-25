import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { withCoverage } = require('../server/prices.js');

test('after the night\'s load, each chain says how many of the common products it sells, and a sudden drop is marked', () => {
  const done = [{ key: 'a', count: 9000, error: null }, { key: 'b', count: 8000, error: null }, { key: 'c', count: 0, error: 'HTTP 403' }, { key: 'a-online', count: 5000, error: null, online: true }, { key: 'd', count: 10, error: null }];
  const cover = [{ chain: 'a', has: 490 }, { chain: 'b', has: 300 }, { chain: 'a-online', has: 470 }, { chain: 'd', has: 20 }];
  const before = [{ key: 'a', cover: 495 }, { key: 'b', cover: 480 }, { key: 'a-online', cover: 470 }, { key: 'd', cover: 60 }];
  const out = withCoverage(done, cover, before);
  assert.deepEqual(out[0], { key: 'a', count: 9000, error: null, cover: 490, coverOf: 500 }, 'a little less: not a drop');
  assert.equal(out[1].cover, 300);
  assert.equal(out[1].coverDrop, 480, 'from 480 to 300: marked, with the night before');
  assert.deepEqual(out[2], done[2], 'a chain that did not load keeps its error');
  assert.equal(out[3].cover, 470);
  assert.equal(out[4].coverDrop, undefined, 'a chain that always had few is not a drop');
});

test('the first night (nothing to compare with), or no coverage at all: nothing is marked', () => {
  const done = [{ key: 'a', count: 1, error: null }];
  assert.deepEqual(withCoverage(done, [{ chain: 'a', has: 100 }], null), [{ key: 'a', count: 1, error: null, cover: 100, coverOf: 500 }]);
  assert.deepEqual(withCoverage(done, null, null), done);
});
