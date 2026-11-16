import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { retryLater } = require('../server/prices.js');

test('after the night\'s load, chains whose site did not answer or had no files yet are tried again', () => {
  const done = [
    { key: 'a', error: null },
    { key: 'b', error: 'fetch failed (UND_ERR_CONNECT_TIMEOUT)' },
    { key: 'c', error: 'fetch failed (EAI_AGAIN)' },
    { key: 'd', error: 'HTTP 403 shop.example.co.il' },
    { key: 'e', error: 'no files' },
    { key: 'f', error: 'save: duplicate key' },
    { key: 'g', error: 'socket hang up' }
  ];
  assert.deepEqual(retryLater(done), ['b', 'c', 'e', 'g']);
  assert.deepEqual(retryLater([]), []);
  assert.deepEqual(retryLater(null), []);
});

// The morning try reads the night's record as it was saved: a chain the
// night already tried three times ("no files (גם בניסיון השני והשלישי)") is
// tried once more; its online shop (a delivery point with no file) is not.
test('the morning try takes the chains the night could not read, not the online shops', () => {
  const night = [
    { key: 'shufersal', count: 7508, error: null },
    { key: 'osher-ad', count: 0, error: 'no files (גם בניסיון השני והשלישי)', retried: true, retriedLate: true },
    { key: 'keshet-online', count: 0, error: 'no file for branch', online: true },
    { key: 'good-pharm-online', count: 0, error: 'no file for branch', online: true }
  ];
  assert.deepEqual(retryLater(night), ['osher-ad']);
});
