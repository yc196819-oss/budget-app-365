import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { readDraft, writeDraft, dropDraft, draftFits } = await import('../public/app/src/data/importDraft.js');

const items = [{ key: 'a', description: 'חנות בדויה', amount: 50 }];

test('a draft is kept per household, and read back as written', () => {
  writeDraft('h1', { fileName: 'x.xlsx', items, sourceId: 'c1' }, 1000);
  assert.equal(readDraft('h1', 2000).fileName, 'x.xlsx');
  assert.equal(readDraft('h2', 2000), null);
});

test('after a week, or with no lines, there is no draft', () => {
  writeDraft('h1', { items }, 0);
  assert.equal(readDraft('h1', 8 * 24 * 3600 * 1000), null);
  writeDraft('h1', { items: [] }, 0);
  assert.equal(readDraft('h1', 1), null);
});

test('dropped means gone; a broken value reads as none', () => {
  writeDraft('h1', { items }, 0);
  dropDraft('h1');
  assert.equal(readDraft('h1', 1), null);
  store.set('import:draft:h1', '{not json');
  assert.equal(readDraft('h1', 1), null);
});

test('blocked storage never throws', () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(readDraft('h1'), null);
  assert.doesNotThrow(() => writeDraft('h1', { items }));
  assert.doesNotThrow(() => dropDraft('h1'));
  globalThis.localStorage = saved;
});

test('a draft fits an upload for its own source, or one not tied to any', () => {
  assert.equal(draftFits({ sourceId: 'c1' }, null), true);
  assert.equal(draftFits({ sourceId: 'c1' }, { id: 'c1' }), true);
  assert.equal(draftFits({ sourceId: null }, { id: 'c2' }), true);
  assert.equal(draftFits({ sourceId: 'c1' }, { id: 'c2' }), false);
  assert.equal(draftFits(null, null), false);
});
