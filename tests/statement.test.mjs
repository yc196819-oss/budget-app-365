import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, normalizeDate, parseCsv, detectHeader, rowsToTransactions, cleanCategory, categoryTreeText,
  fromAi, waitingMerchants, applyAiCategories, categorizeFromHistory, setItemCategory, similarText,
  flagDuplicates, prepare, summary, toRows, withKeys, installmentDeals
} from '../public/app/src/domain/statement.js';
import { shortDate } from '../public/app/src/domain/format.js';

const CATS = [
  { id: 'food', name: 'אוכל', kind: 'expense', parent_id: null },
  { id: 'super', name: 'סופר', kind: 'expense', parent_id: 'food' },
  { id: 'shufersal', name: 'שופרסל', kind: 'expense', parent_id: 'super' },
  { id: 'car', name: 'רכב', kind: 'expense', parent_id: null },
  { id: 'fuel', name: 'דלק', kind: 'expense', parent_id: 'car' },
  { id: 'sal', name: 'משכורת', kind: 'income', parent_id: null },
  { id: 'refund', name: 'החזרים', kind: 'income', parent_id: null }
];
const byId = new Map(CATS.map((c) => [c.id, c]));

test('parseAmount handles shekel signs, commas and the ways statements write minus', () => {
  assert.equal(parseAmount('₪1,234.50'), 1234.5);
  assert.equal(parseAmount('12.00-'), -12);
  assert.equal(parseAmount('-12'), -12);
  assert.equal(parseAmount('(40)'), -40);
  assert.equal(parseAmount(' 99 ש"ח'), 99);
  assert.equal(parseAmount(245.9), 245.9);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('שופרסל'), null);
  assert.equal(parseAmount('12/08/2026'), null);
});

test('normalizeDate reads Israeli, ISO and Excel dates and rejects nonsense', () => {
  assert.equal(normalizeDate('15/08/2026'), '2026-08-15');
  assert.equal(normalizeDate('5.8.26'), '2026-08-05');
  assert.equal(normalizeDate('2026-08-15'), '2026-08-15');
  assert.equal(normalizeDate('15-08-2026'), '2026-08-15');
  assert.equal(normalizeDate(46249), '2026-08-15');
  assert.equal(normalizeDate('46249'), '2026-08-15');
  assert.equal(normalizeDate('31/02/2026'), null);
  assert.equal(normalizeDate('123'), null);
  assert.equal(normalizeDate('תאריך'), null);
});

test('parseCsv: quotes, commas inside quotes, CRLF, semicolons and tabs', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(parseCsv('﻿a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a\tb\n\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('detectHeader prefers the charged amount over the original amount', () => {
  const h = detectHeader(['תאריך עסקה', 'שם בית העסק', 'סכום עסקה מקורי', 'סכום חיוב', 'תאריך חיוב']);
  assert.deepEqual([h.date, h.desc, h.amount], [0, 1, 3]);
  assert.equal(detectHeader(['פירוט עסקאות', '', '']), null);
  assert.equal(detectHeader(['15/08/2026', 'שופרסל', '100']), null);
});

test('a card statement (title rows, two tables, totals, refunds) becomes clean lines', () => {
  const rows = [
    ['פירוט עסקאות לכרטיס 1234'],
    [],
    ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב', 'הערות'],
    ['12/08/2026', 'שופרסל דיל ת"א', '245.90', '245.90', ''],
    ['13/08/2026', 'פז אילת', '₪300.00', '₪300.00', ''],
    ['14/08/2026', 'זיכוי - ZARA', '-120', '-120', ''],
    ['', 'סה"כ', '', '425.90', ''],
    ['עסקאות בחו"ל'],
    ['תאריך רכישה', 'שם בית עסק', 'סכום מקור', 'סכום חיוב בש"ח'],
    [46251, 'AMAZON MKTPLACE', '20$', 74.4]
  ];
  assert.deepEqual(rowsToTransactions(rows), [
    { date: '2026-08-12', description: 'שופרסל דיל ת"א', amount: 245.9, type: 'expense' },
    { date: '2026-08-13', description: 'פז אילת', amount: 300, type: 'expense' },
    { date: '2026-08-14', description: 'זיכוי - ZARA', amount: 120, type: 'income' },
    { date: '2026-08-17', description: 'AMAZON MKTPLACE', amount: 74.4, type: 'expense' }
  ]);
});

test('a bank statement with debit and credit columns', () => {
  const rows = [
    ['תאריך', 'תיאור', 'אסמכתא', 'חובה', 'זכות', 'יתרה'],
    ['01/09/2026', 'משכורת', '1', '', '12,500.00', '15,000'],
    ['02/09/2026', 'הוראת קבע ועד בית', '2', '150.00', '', '14,850']
  ];
  assert.deepEqual(rowsToTransactions(rows), [
    { date: '2026-09-01', description: 'משכורת', amount: 12500, type: 'income' },
    { date: '2026-09-02', description: 'הוראת קבע ועד בית', amount: 150, type: 'expense' }
  ]);
});

test('rows before any header, or without date or amount, are skipped', () => {
  assert.deepEqual(rowsToTransactions([['12/08/2026', 'x', '10']]), []);
  assert.deepEqual(rowsToTransactions([['תאריך', 'תיאור', 'סכום'], ['', 'x', '10'], ['12/08/2026', 'x', ''], ['12/08/2026', '', '5']]), []);
});

test('cleanCategory keeps only real ids and fixes a sub-category sent as category', () => {
  assert.deepEqual(cleanCategory('expense', 'shufersal', null, byId), { category_id: 'food', subcategory_id: 'shufersal' });
  assert.deepEqual(cleanCategory('expense', 'food', 'super', byId), { category_id: 'food', subcategory_id: 'super' });
  assert.deepEqual(cleanCategory('expense', 'food', 'fuel', byId), { category_id: 'food', subcategory_id: null });
  assert.deepEqual(cleanCategory('expense', 'nope', null, byId), { category_id: null, subcategory_id: null });
  assert.deepEqual(cleanCategory('expense', 'sal', null, byId), { category_id: null, subcategory_id: null });
  assert.deepEqual(cleanCategory('income', 'refund', null, byId), { category_id: 'refund', subcategory_id: null });
  assert.deepEqual(cleanCategory('expense', null, 'fuel', byId), { category_id: 'car', subcategory_id: 'fuel' });
});

test('categoryTreeText lists the tree with ids, expenses then income', () => {
  const t = categoryTreeText(CATS);
  assert.match(t, /- אוכל \(id:food\)\n {2}- סופר \(id:super\)\n {4}- שופרסל \(id:shufersal\)/);
  assert.ok(t.indexOf('משכורת') > t.indexOf('קטגוריות הכנסה'));
});

test('fromAi cleans what the AI returned and drops bad lines', () => {
  const out = fromAi([
    { date: '12/08/2026', description: ' שופרסל ', amount: '-245.9', type: 'expense', category_id: 'shufersal' },
    { date: 'bad', description: 'x', amount: 10 },
    { date: '2026-08-13', description: 'y', amount: 0 },
    { date: '2026-08-14', description: 'החזר', amount: 50, type: 'income', category_id: 'food' }
  ], CATS);
  assert.deepEqual(out, [
    { date: '2026-08-12', description: 'שופרסל', amount: 245.9, type: 'expense', category_id: 'food', subcategory_id: 'shufersal', auto: 'ai' },
    { date: '2026-08-14', description: 'החזר', amount: 50, type: 'income', category_id: null, subcategory_id: null, auto: null }
  ]);
  assert.deepEqual(fromAi('not an array', CATS), []);
});

test('history first: the same merchant gets the category the household chose last time', () => {
  const history = [
    { type: 'expense', description: 'שופרסל דיל 123', category_id: 'food', subcategory_id: 'shufersal', tx_date: '2026-07-01' },
    { type: 'income', description: 'שופרסל', category_id: 'refund', tx_date: '2026-07-02' }
  ];
  const out = categorizeFromHistory([{ description: 'שופרסל דיל ת"א', type: 'expense' }, { description: 'מוסך', type: 'expense' }], history);
  assert.equal(out[0].category_id, 'food');
  assert.equal(out[0].subcategory_id, 'shufersal');
  assert.equal(out[0].auto, 'history');
  assert.equal(out[1].category_id, undefined);
});

test('only one line per unknown merchant goes to the AI, and its answer fills them all', () => {
  const items = [
    { description: 'פז אילת', type: 'expense', category_id: null },
    { description: 'פז אילת', type: 'expense', category_id: null },
    { description: 'שופרסל', type: 'expense', category_id: 'food' },
    { description: 'מוסך', type: 'expense', category_id: null }
  ];
  const sent = waitingMerchants(items);
  assert.deepEqual(sent.map((t) => t.description), ['פז אילת', 'מוסך']);
  const out = applyAiCategories(items, sent, [{ i: 0, category_id: 'car', subcategory_id: 'fuel' }, { i: 1, category_id: 'made-up' }, { i: 9, category_id: 'car' }], CATS);
  assert.deepEqual(out.map((t) => t.category_id), ['car', 'car', 'food', null]);
  assert.equal(out[0].auto, 'ai');
  assert.equal(out[2].auto, undefined);
});

test('choosing a category for a line also fills waiting lines of the same merchant', () => {
  const items = withKeys([
    { description: 'פז אילת', type: 'expense', category_id: null },
    { description: 'פז', type: 'expense', category_id: null },
    { description: 'פז', type: 'expense', category_id: 'food' },
    { description: 'פז', type: 'income', category_id: null }
  ]);
  const out = setItemCategory(items, 'i0', 'car', 'fuel');
  assert.deepEqual(out.map((t) => t.category_id), ['car', 'car', 'food', null]);
  assert.equal(setItemCategory(items, 'nope', 'car', null), items);
});

test('duplicates: same amount within 3 days, "likely" starts unchecked, "maybe" stays checked', () => {
  const existing = [
    { type: 'expense', amount: 300, tx_date: '2026-08-13', description: 'פז אילת' },
    { type: 'expense', amount: 50, tx_date: '2026-08-11', description: 'משהו אחר' }
  ];
  const out = flagDuplicates([
    { date: '2026-08-13', amount: 300, type: 'expense', description: 'פז' },
    { date: '2026-08-12', amount: 50, type: 'expense', description: 'קפה' },
    { date: '2026-08-20', amount: 300, type: 'expense', description: 'פז' },
    { date: '2026-08-13', amount: 300, type: 'income', description: 'פז' }
  ], existing);
  assert.deepEqual(out.map((t) => t.dupe), ['likely', 'maybe', null, null]);
  assert.deepEqual(out.map((t) => t.include), [false, true, true, true]);
  assert.deepEqual(out[0].dupeOf, { date: '2026-08-13', description: 'פז אילת' });
});

test('the same line twice in one file is two real charges (two train tickets): flagged "maybe", both kept', () => {
  const line = { date: '2026-10-08', amount: 11.5, type: 'expense', description: 'רכבת ישראל - נמל תעופה' };
  const out = flagDuplicates([line, { ...line }], []);
  assert.deepEqual(out.map((t) => t.dupe), [null, 'maybe']);
  assert.deepEqual(out.map((t) => t.include), [true, true]);
});

test('the same amount at a different shop on the same day is not a likely duplicate', () => {
  const existing = [{ type: 'expense', amount: 93.42, tx_date: '2026-10-04', description: 'ZARA AFI BRASOV' }];
  const out = flagDuplicates([{ date: '2026-10-04', amount: 93.42, type: 'expense', description: 'STRADIVARIUS AFI BRASOV' }], existing);
  assert.equal(out[0].include, true);
  const same = flagDuplicates([{ date: '2026-10-04', amount: 93.42, type: 'expense', description: 'ZARA AFI BRASOV' }], existing);
  assert.equal(same[0].dupe, 'likely');
});

test('each installment payment is new money: payment 3 of 14 is not a duplicate of payment 1', () => {
  const existing = [{ type: 'expense', amount: 250, tx_date: '2026-07-30', description: 'רהיטים בע"מ (תשלום 1 מתוך 14)' }];
  const p3 = flagDuplicates([{ date: '2026-07-30', amount: 250, type: 'expense', description: 'רהיטים בע"מ (תשלום 3 מתוך 14)' }], existing);
  assert.equal(p3[0].dupe, null);
  const again = flagDuplicates([{ date: '2026-07-30', amount: 250, type: 'expense', description: 'רהיטים בע"מ (תשלום 1 מתוך 14)' }], existing);
  assert.equal(again[0].dupe, 'likely', 'the same payment uploaded twice is still caught');
});

test('fromAi: one installment label, the charge-date the AI gives, and the card digits', () => {
  const [a, b, c] = fromAi([
    { date: '2026-10-10', description: 'רהיטים בע"מ', amount: 250, installment: { n: 3, of: 14 }, card: '••7927' },
    { date: '2026-10-11', description: 'ספרים (תשלום 3 מתוך 4)', amount: 875, installment: null },
    { date: '2026-10-11', description: 'מספרה', amount: 60, installment: { n: 5, of: 2 }, card: '12' }
  ], CATS);
  assert.equal(a.description, 'רהיטים בע"מ (תשלום 3 מתוך 14)');
  assert.equal(a.date, '2026-10-10');
  assert.equal(a.card4, '7927');
  assert.equal(b.description, 'ספרים (תשלום 3 מתוך 4)');
  assert.equal(c.description, 'מספרה', 'an impossible installment is ignored');
  assert.equal(c.card4, undefined);
});

test('rows go on the card the statement shows for each line, else the chosen card', () => {
  const items = prepare([
    { date: '2026-10-05', amount: 40, type: 'expense', description: 'x', card4: '7518' },
    { date: '2026-10-05', amount: 50, type: 'expense', description: 'y', card4: '0000' },
    { date: '2026-10-05', amount: 60, type: 'expense', description: 'z' }
  ], []);
  const rows = toRows(items, { cardId: 'main', cards: [{ id: 'sky', last4: '7518' }, { id: 'other' }] });
  assert.deepEqual(rows.map((r) => r.card_id), ['sky', 'main', 'main']);
});

test('similarText ignores installment notes and punctuation', () => {
  assert.equal(similarText('איקאה (תשלום 2 מתוך 3)', 'איקאה'), true);
  assert.equal(similarText('אתר קרנות', 'מעשרות וולפצון'), false);
});

test('summary and rows to save', () => {
  const items = prepare([
    { date: '2026-08-12', amount: 100, type: 'expense', description: 'a', category_id: 'food', subcategory_id: null },
    { date: '2026-08-15', amount: 40, type: 'expense', description: 'b', category_id: null, subcategory_id: null },
    { date: '2026-08-14', amount: 20, type: 'income', description: 'c', category_id: null, subcategory_id: null },
    { date: '2026-08-12', amount: 100, type: 'expense', description: 'a', category_id: 'food', subcategory_id: null }
  ], []);
  const s = summary(items);
  assert.deepEqual({ ...s }, { found: 4, chosen: 4, auto: 2, waiting: 2, likely: 0, maybe: 1, expense: 240, income: 20, from: '2026-08-12', to: '2026-08-15' });
  const rows = toRows(items);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { type: 'expense', amount: 100, description: 'a', tx_date: '2026-08-12', category_id: 'food', subcategory_id: null, nature: 'variable', spread: 'month', source: 'pdf' });
  const carded = toRows(items, { cardId: 'c1' });
  assert.ok(carded.every((r) => r.card_id === 'c1' && r.payment_method === 'credit'));
});

test('shortDate', () => {
  assert.equal(shortDate('2026-08-05'), '5.8');
  assert.equal(shortDate(''), '');
});

test('an installment payment creates its deal, dated from the first charge, once per deal', () => {
  const rows = [
    { type: 'expense', amount: 250, description: 'רהיטים בע"מ (תשלום 3 מתוך 14)', tx_date: '2026-10-10', category_id: 'home', subcategory_id: 'furniture' },
    { type: 'expense', amount: 250, description: 'רהיטים בע"מ (תשלום 3 מתוך 14)', tx_date: '2026-10-10' },
    { type: 'expense', amount: 40, description: 'קפה', tx_date: '2026-10-10' },
    { type: 'income', amount: 100, description: 'זיכוי (תשלום 1 מתוך 2)', tx_date: '2026-10-10' }
  ];
  const { create, update } = installmentDeals(rows, []);
  assert.deepEqual(create, [{ description: 'רהיטים בע"מ', total_amount: 3500, payments_count: 14, first_payment: '2026-08-10', category_id: 'furniture' }]);
  assert.deepEqual(update, []);
});

test('a known deal is not created again; a wrong first payment (the purchase date) is corrected', () => {
  const existing = [{ id: 'd1', description: 'איילון רכב חובה', total_amount: 2958, payments_count: 12, first_payment: '2025-11-30' }];
  const rows = [{ type: 'expense', amount: 246.5, description: 'איילון רכב חובה (תשלום 11 מתוך 12)', tx_date: '2026-10-11' }];
  assert.deepEqual(installmentDeals(rows, existing), { create: [], update: [{ id: 'd1', first_payment: '2025-12-11' }] });
  const right = [{ ...existing[0], first_payment: '2025-12-11' }];
  assert.deepEqual(installmentDeals(rows, right), { create: [], update: [] });
});

test('the first payment keeps the day, clamped to the month (31st)', () => {
  const { create } = installmentDeals([{ type: 'expense', amount: 100, description: 'x (תשלום 2 מתוך 3)', tx_date: '2026-03-31' }]);
  assert.equal(create[0].first_payment, '2026-02-28');
});
