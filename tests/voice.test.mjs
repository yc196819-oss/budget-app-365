import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpoken, wordsToNumbers } from '../public/app/src/domain/voice.js';

test('Hebrew number words become digits', () => {
  assert.equal(wordsToNumbers('שמונים'), '80');
  assert.equal(wordsToNumbers('מאה וחמישים שקל'), '150 שקל');
  assert.equal(wordsToNumbers('שלוש מאות ועשרים'), '320');
  assert.equal(wordsToNumbers('אלף וחמש מאות'), '1500');
  assert.equal(wordsToNumbers('21 אלף'), '21000');
  assert.equal(wordsToNumbers('2.5 אלף'), '2500');
  assert.equal(wordsToNumbers('אלפיים ושלוש מאות'), '2300');
  assert.equal(wordsToNumbers('קפה בארומה'), 'קפה בארומה');
});

test('what people say when adding an expense', () => {
  assert.deepEqual(parseSpoken('שילמתי 80 שקל בסופר'), { amount: 80, description: 'סופר', type: 'expense' });
  assert.deepEqual(parseSpoken('שילמתי שמונים שקל בסופר'), { amount: 80, description: 'סופר', type: 'expense' });
  assert.deepEqual(parseSpoken('קניתי דלק במאתיים וחמישים שקל'), { amount: 250, description: 'דלק', type: 'expense' });
  assert.deepEqual(parseSpoken('הוצאתי 46 שקל על קפה בארומה'), { amount: 46, description: 'קפה בארומה', type: 'expense' });
  assert.deepEqual(parseSpoken('46 קפה בארומה'), { amount: 46, description: 'קפה בארומה', type: 'expense' }, 'typed text works as before');
  assert.deepEqual(parseSpoken('ארוחה במסעדה 320 ש"ח.'), { amount: 320, description: 'ארוחה במסעדה', type: 'expense' });
});

test('income is recognized by itself', () => {
  assert.deepEqual(parseSpoken('קיבלתי משכורת 21 אלף'), { amount: 21000, description: 'משכורת', type: 'income' });
  assert.deepEqual(parseSpoken('נכנס החזר מביטוח לאומי 500 שקל'), { amount: 500, description: 'החזר מביטוח לאומי', type: 'income' });
  assert.equal(parseSpoken('בונוס אלפיים').type, 'income');
});

test('no amount or nothing but an amount: nothing to add', () => {
  assert.equal(parseSpoken('שילמתי בסופר'), null);
  assert.equal(parseSpoken('80 שקל'), null);
  assert.equal(parseSpoken(''), null);
});

test('a long recording is split into separate transactions', async () => {
  const { splitSpoken } = await import('../public/app/src/domain/voice.js');
  const pick = (r) => r.items.map((i) => [i.type, i.amount, i.description, i.daysAgo]);
  assert.deepEqual(pick(splitSpoken('שילמתי 80 שקל בסופר ו-46 על קפה ו200 דלק')), [['expense', 80, 'סופר', 0], ['expense', 46, 'קפה', 0], ['expense', 200, 'דלק', 0]]);
  assert.deepEqual(pick(splitSpoken('סופר 80 קפה 46')), [['expense', 80, 'סופר', 0], ['expense', 46, 'קפה', 0]]);
  assert.deepEqual(pick(splitSpoken('לחם 12 ובית קפה 30')), [['expense', 12, 'לחם', 0], ['expense', 30, 'בית קפה', 0]]);
  // Type and day carry over until said otherwise.
  assert.deepEqual(pick(splitSpoken('אתמול קניתי לחם ב-12 וחלב ב-8, ואז קיבלתי משכורת 21 אלף')), [['expense', 12, 'לחם', 1], ['expense', 8, 'חלב', 1], ['income', 21000, 'משכורת', 1]]);
  assert.deepEqual(pick(splitSpoken('קיבלתי 500 מאמא ו300 מאבא')), [['income', 500, 'מאמא', 0], ['income', 300, 'מאבא', 0]]);
  assert.deepEqual(pick(splitSpoken('שילמתי שמונים שקל בסופר, מאה וחמישים בפארם. ובונוס אלפיים')), [['expense', 80, 'סופר', 0], ['expense', 150, 'בפארם', 0], ['income', 2000, 'בונוס', 0]]);
  // Thousands separators and decimals are not cut.
  assert.deepEqual(pick(splitSpoken('קניתי מקרר ב-1,500 שקל')), [['expense', 1500, 'מקרר', 0]]);
  assert.deepEqual(pick(splitSpoken('46 קפה בארומה')), [['expense', 46, 'קפה בארומה', 0]]);
  assert.deepEqual(splitSpoken('').items, []);
});

test('the day is understood: yesterday and the day before', () => {
  assert.equal(parseSpoken('אתמול שילמתי 30 על חניה', { details: true }).daysAgo, 1);
  assert.equal(parseSpoken('שלשום 30 חניה', { details: true }).daysAgo, 2);
  assert.equal(parseSpoken('30 חניה', { details: true }).daysAgo, null);
  assert.equal(parseSpoken('אתמול שילמתי 30 על חניה').description, 'חניה');
});

test('review cards: category guessed per kind, dates from the words, and back to transactions', async () => {
  const { toReviewItems, reviewToTx, reviewValid } = await import('../public/app/src/domain/voice.js');
  const guess = (desc, type) => (desc === 'קפה' && type === 'expense' ? { category_id: 'food', subcategory_id: 'cafe' } : desc === 'משכורת' ? { category_id: 'sal', subcategory_id: null } : null);
  const today = new Date(2026, 9, 1);
  const cards = toReviewItems([{ amount: 46, description: 'קפה', type: 'expense', daysAgo: 1 }, { amount: 21000, description: 'משכורת', type: 'income', daysAgo: 0 }, { amount: 30, description: 'חניה', type: 'expense', daysAgo: 2 }], guess, today);
  assert.deepEqual(cards.map((c) => [c.catId, c.date]), [['cafe', '2026-09-30'], ['sal', '2026-10-01'], ['', '2026-09-29']]);
  const cats = [{ id: 'food', parent_id: null }, { id: 'cafe', parent_id: 'food' }, { id: 'sal', parent_id: null }];
  assert.deepEqual(reviewToTx(cards[0], cats), { type: 'expense', amount: 46, description: 'קפה', tx_date: '2026-09-30', category_id: 'food', subcategory_id: 'cafe' });
  assert.deepEqual(reviewToTx(cards[1], cats), { type: 'income', amount: 21000, description: 'משכורת', tx_date: '2026-10-01', category_id: 'sal', subcategory_id: null });
  assert.equal(reviewToTx(cards[2], cats).category_id, null);
  assert.equal(reviewValid(cards[0]), true);
  assert.equal(reviewValid({ ...cards[0], amount: 0 }), false);
  assert.equal(reviewValid({ ...cards[0], description: ' ' }), false);
});

test('a recording is joined once, even when the phone re-sends earlier words', async () => {
  const { mergeFinals } = await import('../public/app/src/domain/voice.js');
  assert.equal(mergeFinals(['80 בסופר', '46 קפה']), '80 בסופר 46 קפה');
  assert.equal(mergeFinals(['80 בסופר', '80 בסופר ו-46 קפה', '80 בסופר ו-46 קפה ו-200 דלק']), '80 בסופר ו-46 קפה ו-200 דלק');
  assert.equal(mergeFinals(['80 בסופר ו-46 קפה', '80 בסופר']), '80 בסופר ו-46 קפה');
  assert.equal(mergeFinals(['', ' 30 חניה ']), '30 חניה');
});

test('dollars, euros and pounds are recognized, with the place after the currency', async () => {
  const { parseSpoken, splitSpoken, detectCurrency } = await import('../public/app/src/domain/voice.js');
  assert.deepEqual(parseSpoken('$50 אמזון'), { amount: 50, description: 'אמזון', type: 'expense', currency: 'USD' });
  assert.deepEqual(parseSpoken('קניתי ב-50 דולר באמזון'), { amount: 50, description: 'אמזון', type: 'expense', currency: 'USD' });
  assert.deepEqual(parseSpoken('נטפליקס 15.99$'), { amount: 15.99, description: 'נטפליקס', type: 'expense', currency: 'USD' });
  assert.deepEqual(parseSpoken('מלון בפריז 320 יורו'), { amount: 320, description: 'מלון בפריז', type: 'expense', currency: 'EUR' });
  assert.deepEqual(parseSpoken('£40 מתנה'), { amount: 40, description: 'מתנה', type: 'expense', currency: 'GBP' });
  assert.deepEqual(parseSpoken('קיבלתי 1,000 דולר מפרילנס'), { amount: 1000, description: 'מפרילנס', type: 'income', currency: 'USD' });
  assert.deepEqual(parseSpoken('46 קפה בארומה'), { amount: 46, description: 'קפה בארומה', type: 'expense' }, 'shekels stay as before');
  assert.equal(detectCurrency('80 שקל'), null);
  const r = splitSpoken('50 דולר באמזון ו-80 שקל בסופר');
  assert.deepEqual(r.items.map((i) => [i.amount, i.description, i.currency || 'ILS']), [[50, 'אמזון', 'USD'], [80, 'סופר', 'ILS']]);
});

test('a foreign card is saved in shekels by the rate of its date, the original amount kept', async () => {
  const { toReviewItems, reviewToTx, reviewValid, inShekels } = await import('../public/app/src/domain/voice.js');
  const [card] = toReviewItems([{ amount: 50, description: 'אמזון', type: 'expense', currency: 'USD', daysAgo: 0 }], () => null, new Date(2026, 8, 13));
  assert.equal(card.currency, 'USD');
  assert.equal(reviewValid(card), false, 'no rate yet');
  const withRate = { ...card, rate: 3.688, rateDate: '2026-09-11' };
  assert.equal(reviewValid(withRate), true);
  assert.equal(inShekels(withRate), 184.4);
  const tx = reviewToTx(withRate, []);
  assert.equal(tx.amount, 184.4);
  assert.equal(tx.description, 'אמזון ($50, שער 3.688)');
  assert.equal(tx.tx_date, '2026-09-13');
  assert.equal(inShekels({ amount: 46, currency: 'ILS' }), 46);
});
