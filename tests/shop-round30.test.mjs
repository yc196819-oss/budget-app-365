import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItem } from '../public/app/src/domain/shopping.js';
import { looser } from '../public/app/src/domain/prices.js';

test('round 30: a size is part of the name, not how many', () => {
  assert.deepEqual(parseItem('טיטולים מידה 4'), { name: 'טיטולים מידה 4', qty: null });
  assert.deepEqual(parseItem('מטרנה שלב 2'), { name: 'מטרנה שלב 2', qty: null });
  assert.deepEqual(parseItem('ביצים L 12'), { name: 'ביצים L 12', qty: null }, 'a tray of 12');
  assert.deepEqual(parseItem('ביצים 3'), { name: 'ביצים', qty: '×3' }, 'three trays');
  assert.deepEqual(parseItem('במבה x3'), { name: 'במבה', qty: '×3' });
  assert.deepEqual(parseItem('טיטולים x2'), { name: 'טיטולים', qty: '×2' });
});

test('round 30: what found nothing is searched again, looser', () => {
  assert.equal(looser('חלות לשבת'), 'חלה');
  assert.equal(looser('קוקה קולה 1.5 ליטר שישייה'), 'קוקה קולה');
  assert.equal(looser('נייר טואלט 32 גלילים'), 'נייר טואלט');
  assert.equal(looser('עוף שלם קפוא'), 'עוף שלם');
  assert.equal(looser('חלב'), null, 'nothing to loosen');
  assert.equal(looser('חומוס צבר'), null, 'two words are kept');
});

test('round 31: disposables as the chains write them', async () => {
  const { searchTerm } = await import('../public/app/src/domain/prices.js');
  assert.equal(searchTerm('כוסות חד פעמיות'), 'כוסות חד');
  assert.equal(searchTerm('צלחות חד-פעמיות'), 'צלחות חד');
  assert.equal(searchTerm('מגשים ח"פ'), 'מגשים חד');
  assert.equal(searchTerm('חלב'), 'חלב');
});
