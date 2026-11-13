import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promoCost, promoBlock, promoText, blockText, offText } from '../public/app/src/domain/promos.js';
const require = createRequire(import.meta.url);
const { parsePromoFile, promoRows } = require('../server/promos.js');

// A made-up deals file, shaped like the chains' official one.
const item = (code, { min = 1, max = '', price, rate = '', w = 0 }) => `<PromotionItem><ItemCode>${code}</ItemCode><MinQty>${min}</MinQty><MaxQty>${max}</MaxQty><DiscountRate>${rate}</DiscountRate><DiscountedPrice>${price}</DiscountedPrice><bIsWeighted>${w}</bIsWeighted></PromotionItem>`;
const promo = ({ id, text, club = '0', coupon = 0, minBuy = '0.00', end = '2026-12-05T23:59:00.000', gift = '', limit = '', items }) => `<Promotion><PromotionID>${id}</PromotionID><PromotionDescription>${text}</PromotionDescription><PromotionStartDateTime>2026-11-01T00:00:00.000</PromotionStartDateTime><PromotionEndDateTime>${end}</PromotionEndDateTime><RedemptionLimit>${limit}</RedemptionLimit><ClubID>${club}</ClubID><IsGiftItem>${gift}</IsGiftItem><AdditionalIsCoupon>${coupon}</AdditionalIsCoupon><Groups><Group><MinPurchaseAmount>${minBuy}</MinPurchaseAmount><PromotionItems>${items}</PromotionItems></Group></Groups></Promotion>`;
const FILE = '<Root><Promotions>' + [
  promo({ id: '1', text: 'קרקרים 2ב15', items: item('7290000000011', { min: 2, price: 15, rate: 24.24 }) }),
  promo({ id: '2', text: 'טונה 2ב48 מעל 75 מו4', minBuy: '75.00', limit: 2, items: item('7290000000028', { min: 1, price: 48, rate: 16.67 }) }),
  promo({ id: '3', text: 'קרם גוף ב16.90 מועדון', club: '(1=מועדון שיווק)', items: item('7290000000035', { price: 16.9, rate: 29.29 }) }),
  promo({ id: '4', text: 'קופון טונה 15%', coupon: 1, items: item('7290000000028', { price: 24.48, rate: 15 }) }),
  promo({ id: '5', text: 'קופון מתנה', gift: 1, coupon: 1, items: item('7290000000042', { price: 0, rate: 100 }) }),
  promo({ id: '6', text: 'ישן', end: '2026-10-01T23:59:00.000', items: item('7290000000011', { price: 5 }) }),
  promo({ id: '7', text: 'לא באמת מבצע', items: item('7290000000059', { price: 12 }) }),
  promo({ id: '8', text: 'קוד קצר', items: item('123', { price: 1 }) }),
  promo({ id: '9', text: 'שופרסל לכולם', club: '0 - כלל הלקוחות', items: item('7290000000066', { price: 3 }) }),
  promo({ id: '10', text: 'שופרסל אשראי', club: '2 - מועדון אשראי של הקמעונאי', items: item('7290000000066', { price: 2 }) })
].join('') + '</Promotions></Root>';
const REG = new Map([['7290000000011', 9.9], ['7290000000028', 28.8], ['7290000000035', 23.9], ['7290000000042', 5], ['7290000000059', 11.9]]);
const NOW = new Date('2026-11-13T10:00:00Z');

test('deals file: who gets it, coupon, minimum purchase, until when, and the products', () => {
  const p = parsePromoFile(FILE);
  assert.equal(p.length, 9, 'a deal with no real barcode is left out');
  assert.equal(p.find((x) => x.id === '9').everyone, true, '"0 - כלל הלקוחות"');
  assert.equal(p.find((x) => x.id === '10').everyone, false);
  const tuna = p.find((x) => x.id === '2');
  assert.equal(tuna.everyone, true);
  assert.equal(tuna.minBuy, 75);
  assert.equal(p.find((x) => x.id === '3').everyone, false, 'a club deal');
  assert.equal(p.find((x) => x.id === '4').coupon, true);
  assert.equal(p.find((x) => x.id === '5').gift, true);
});

test('deals into rows: the price of one, and how many to buy', () => {
  const rows = promoRows(parsePromoFile(FILE), REG, { now: NOW });
  const by = (id) => rows.find((r) => r.promo_id === id);
  assert.deepEqual([by('1').need, by('1').unit_price], [2, 7.5], '"2 ב-15": two, at 7.50 each');
  assert.deepEqual([by('2').need, by('2').unit_price, by('2').max_qty], [2, 24, 4], 'written as 1 to buy, but 48 is for two (the discount says so); up to twice');
  assert.ok(!by('5'), 'a gift is not a price');
  assert.ok(!by('6'), 'a deal that is over');
  assert.ok(!by('7'), 'a "deal" dearer than the regular price');
});

test('policy: a deal counts only when anyone gets it, with enough on the list', () => {
  const offer = { price: 9.9, promos: [{ need: 2, unit_price: 7.5, everyone: true, coupon: false, min_buy: 0, ends_at: '2026-12-05T21:59:00Z' }] };
  const one = promoCost(offer, 1, NOW);
  assert.equal(one.cost, 9.9, 'one cracker box: the regular price');
  assert.equal(one.promo, null);
  assert.equal(one.other.why, 'more', 'and the deal is shown: buy two');
  const two = promoCost(offer, 2, NOW);
  assert.deepEqual([two.cost, two.saved], [15, 4.8]);
  assert.equal(promoCost(offer, 3, NOW).cost, 24.9, 'two in the deal, the third at the regular price');
});

test('policy: club, coupon, minimum purchase and a deal over are not counted', () => {
  const base = { need: 1, unit_price: 5, everyone: true, coupon: false, min_buy: 0, ends_at: '2026-12-05T21:59:00Z' };
  assert.equal(promoBlock({ ...base, everyone: false }, 1, NOW), 'club');
  assert.equal(promoBlock({ ...base, coupon: true }, 1, NOW), 'coupon');
  assert.equal(promoBlock({ ...base, min_buy: 75 }, 1, NOW), 'min-buy');
  assert.equal(promoBlock({ ...base, ends_at: '2026-11-12T21:59:00Z' }, 1, NOW), 'not-today');
  assert.equal(promoBlock(base, 1, NOW), null);
  const c = promoCost({ price: 8, promos: [{ ...base, everyone: false }] }, 1, NOW);
  assert.deepEqual([c.cost, c.other.why], [8, 'club']);
  assert.equal(promoCost({ price: 8, promos: [{ ...base, ends_at: '2026-11-12T21:59:00Z' }] }, 1, NOW).other, null, 'a deal that is over is not shown at all');
});

test('policy: the deal\'s limit, and the best of two deals', () => {
  const limited = { need: 2, unit_price: 24, max_qty: 4, everyone: true, coupon: false, min_buy: 0 };
  assert.equal(promoCost({ price: 28.8, promos: [limited] }, 6, NOW).cost, 4 * 24 + 2 * 28.8, 'up to four in the deal');
  const a = { need: 1, unit_price: 9, everyone: true, coupon: false, min_buy: 0 };
  const b = { need: 3, unit_price: 8, everyone: true, coupon: false, min_buy: 0 };
  assert.equal(promoCost({ price: 10, promos: [a, b] }, 3, NOW).promo, b);
  assert.equal(promoCost({ price: 10, promos: [a, b] }, 2, NOW).promo, a);
});

test('deals in words', () => {
  assert.equal(promoText({ need: 2, unit_price: 7.5, ends_at: '2026-12-05T21:59:00Z' }), '2 ב-₪15 · עד 5.12');
  assert.equal(promoText({ need: 1, unit_price: 12.5 }, 15.9), '₪12.50 במקום ₪15.90');
  assert.equal(blockText('min-buy', { min_buy: 75 }), 'בקנייה מעל ₪75');
  assert.equal(offText({ why: 'more', promo: { need: 4, unit_price: 12.53 } }), 'מבצע 4 ב-₪50.12 (לא בסכום: ברשימה פחות מ-4)');
  assert.equal(offText({ why: 'club', promo: { need: 1, unit_price: 2.7 } }), 'מבצע ₪2.70 למועדון בלבד (לא בסכום)');
  assert.equal(offText({ why: 'min-buy', promo: { need: 1, unit_price: 9, min_buy: 75 } }), 'מבצע ₪9 בקנייה מעל ₪75 (לא בסכום)');
});

test('the basket: a chain\'s deal counted by the policy, another only shown', async () => {
  const { basket } = await import('../public/app/src/domain/prices.js');
  const open = { everyone: true, coupon: false, min_buy: 0, ends_at: '2026-12-05T21:59:00Z' };
  const crackers = { barcode: '1', name: 'קרקרים 300 גרם', qty: 300, unit: 'גרם', offers: [
    { chain: 'a', chain_name: 'רשת א', price: 9.9, promos: [{ ...open, need: 2, unit_price: 7.5 }] },
    { chain: 'b', chain_name: 'רשת ב', price: 8.9, promos: [{ ...open, everyone: false, need: 1, unit_price: 6 }] }
  ] };
  const rows = basket([{ id: 'x', pick: crackers, pool: [crackers] }], () => 2, NOW);
  const a = rows.find((r) => r.chain === 'a');
  const b = rows.find((r) => r.chain === 'b');
  assert.deepEqual([a.total, a.saved], [15, 4.8], 'two for ₪15, anyone gets it');
  assert.deepEqual([b.total, b.saved], [17.8, 0], 'the club price is not counted');
  assert.equal(b.lines[0].other.why, 'club', 'but it is shown');
  assert.equal(rows[0].chain, 'a', 'with the deal, chain A is cheaper');
  const one = basket([{ id: 'x', pick: crackers, pool: [crackers] }], () => 1, NOW);
  assert.equal(one[0].chain, 'b', 'for one box, the deal does not apply: chain B is cheaper');
});
