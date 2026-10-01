import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, parseRoute, hrefFor, DEFAULT_TAB } from '../public/app/src/domain/routes.js';

test('four tabs in the agreed order', () => {
  assert.deepEqual(TABS.map((t) => t.key), ['home', 'money', 'plans', 'assets']);
});

test('parseRoute accepts known tabs and falls back to home', () => {
  assert.equal(parseRoute('#/money'), 'money');
  assert.equal(parseRoute('#plans'), 'plans');
  assert.equal(parseRoute('#/assets?x=1'), 'assets');
  assert.equal(parseRoute(''), DEFAULT_TAB);
  assert.equal(parseRoute('#/nope'), DEFAULT_TAB);
  assert.equal(parseRoute('#/__proto__'), DEFAULT_TAB);
});

test('hrefFor builds hash links', () => {
  assert.equal(hrefFor('money'), '#/money');
});
