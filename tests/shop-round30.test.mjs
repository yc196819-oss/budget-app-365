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
  assert.equal(searchTerm('קמח'), 'קמח', 'nothing to change');
});

test('round 32: how many, as families write it', async () => {
  const { count } = await import('../public/app/src/domain/prices.js');
  const toms = { name: 'עגבניות', qty: 1, unit: 'ק"ג' }, cola = { name: 'קוקה קולה 1.5 ליטר', qty: 1.5, unit: 'ליטר' };
  const flour = { name: 'קמח לבן 1 ק"ג', qty: 1, unit: 'ק"ג' }, milk = { name: 'חלב 1% בשקית 1 ליטר', qty: 1, unit: 'ליטר' };
  assert.equal(count('1.5 ק"ג', toms), 1.5, 'loose produce by the kilo');
  assert.equal(count('חצי קילו', toms), 0.5);
  assert.equal(count('1.5 ק"ג', flour), 2, 'a packed kilo is bought whole');
  assert.equal(count('שישייה', cola), 6);
  assert.equal(count('שישייה', { name: 'קוקה קולה שישיית 1.5 ליטר', qty: 9, unit: 'ליטר' }), 1);
  assert.equal(count('2 שישיות', cola), 12);
  assert.equal(count('2 קרטונים', milk), 2);
  assert.equal(count('זוג', milk), 2);
});

test('round 36: what a family means by "לחם" and "עגבניות"', async () => {
  const { searchTerm, special } = await import('../public/app/src/domain/prices.js');
  assert.equal(searchTerm('לחם'), 'לחם אחיד', 'the standard bread');
  assert.equal(searchTerm('לחם מלא'), 'לחם מלא', 'what they typed, when they say which');
  assert.equal(searchTerm('חלב'), 'חלב 3%', 'the regular milk');
  assert.equal(searchTerm('חלב 1%'), 'חלב 1%');
  assert.equal(special('עגבניות שרי עגול', 'עגבניות'), true, 'cherry tomatoes are a special kind');
  assert.equal(special('עגבניות שרי עגול', 'עגבניות שרי'), false, 'unless asked for');
  assert.equal(special('לחם פומפרניקל 750 גרם', 'לחם'), true);
  assert.equal(special('לחם שיפון עגול', 'לחם שיפון'), false);
  assert.equal(special('קמח תופח נפלאות 1קג', 'קמח'), true, 'self-raising flour is a special kind');
  assert.equal(special('גבינה צהובה מגורדת 28%', 'גבינה צהובה'), true, 'grated cheese is a special kind');
  assert.equal(special('גבינה צהובה מגורדת 28%', 'גבינה צהובה מגורדת'), false);
});
