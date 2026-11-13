import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { retryLater } = require('../server/prices.js');

test('after the night\'s load, only chains whose site did not answer are tried again', () => {
  const done = [
    { key: 'a', error: null },
    { key: 'b', error: 'fetch failed (UND_ERR_CONNECT_TIMEOUT)' },
    { key: 'c', error: 'fetch failed (EAI_AGAIN)' },
    { key: 'd', error: 'HTTP 403 shop.example.co.il' },
    { key: 'e', error: 'no files' },
    { key: 'f', error: 'save: duplicate key' },
    { key: 'g', error: 'socket hang up' }
  ];
  assert.deepEqual(retryLater(done), ['b', 'c', 'g']);
  assert.deepEqual(retryLater([]), []);
  assert.deepEqual(retryLater(null), []);
});
