import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOPS, LOGOS, deliveryFor, searchLink, orderLink, pasteLink, pasteText, logoKey, logoSrc, shopKey, GUESS_FEE } from '../public/app/src/domain/chainShops.js';
import { basket, chainNote } from '../public/app/src/domain/prices.js';

test('each online shop has its own delivery and smallest order; an unknown fee is about ₪35.90', () => {
  assert.deepEqual(deliveryFor('rami-levy-online', 100), { fee: 35.9, sure: true, min: null, under: false, note: null });
  const sapir = deliveryFor('super-sapir-online', 150);
  assert.deepEqual([sapir.fee, sapir.sure, sapir.min, sapir.under], [GUESS_FEE, false, 200, true], 'by area: about, and under the ₪200 minimum');
  assert.equal(deliveryFor('super-sapir-online', 250).under, false);
  assert.equal(deliveryFor('shuk-hair-online', 300).min, 250);
  assert.deepEqual([deliveryFor('king-store-online').fee, deliveryFor('king-store-online').sure], [GUESS_FEE, false], 'not found: about');
  assert.equal(deliveryFor('keshet').sure, false, 'the chain\'s pages disagree: about');
});

test('the comparison counts each shop\'s own delivery, and says when the list is under its minimum', () => {
  const p = { barcode: '1', name: 'קמח 1 ק"ג', qty: 1, unit: 'ק"ג', offers: [{ chain: 'super-sapir-online', chain_name: 'סופר ספיר אונליין', price: 5 }, { chain: 'super-sapir', chain_name: 'סופר ספיר', price: 6 }] };
  const rows = basket([{ id: 'a', pick: p, pool: [p] }], () => 10);
  const on = rows.find((r) => r.chain === 'super-sapir-online');
  assert.equal(on.total, 50 + GUESS_FEE);
  assert.equal(on.delivery.under, true, '₪50 is under the ₪200 minimum');
  assert.match(chainNote('super-sapir-online').text, /בערך ₪35\.90.*מינימום להזמנה: ₪200.*לפי האזור/);
  assert.match(chainNote('rami-levy-online').text, /כולל משלוח של ₪35\.90\. ייתכן סכום מינימום/);
});

test('links: search a product on the chain\'s site, order there, paste a whole list', () => {
  assert.equal(searchLink('rami-levy-online', 'חלב 3%'), 'https://www.rami-levy.co.il/he/online/search?q=' + encodeURIComponent('חלב 3%'));
  assert.equal(searchLink('shufersal', 'קמח'), 'https://www.shufersal.co.il/online/he/search?text=' + encodeURIComponent('קמח'));
  assert.equal(searchLink('osher-ad', 'קמח'), null, 'no search checked');
  assert.equal(searchLink('rami-levy', ''), null);
  assert.equal(orderLink('shuk-hair-online'), 'https://www.shukcity.co.il/');
  assert.equal(orderLink('nope'), null);
  assert.equal(pasteLink('hazi-hinam'), 'https://shop.hazi-hinam.co.il/quickbuy/editor');
  assert.equal(pasteLink('rami-levy'), null);
  assert.equal(pasteText([{ name: 'חלב', qty: '×2' }, { name: 'לחם' }, { name: 'קנוי', done: true }, { name: ' ' }]), 'חלב ×2\nלחם');
});

test('logos: served by our server for the chains checked; every address is https on the chain\'s site or its media server', () => {
  assert.equal(logoSrc('rami-levy-online'), '/api/chain-logo/rami-levy');
  assert.equal(logoKey('shefa-birkat'), 'shefa-birkat-hashem', 'an old name of the same chain');
  assert.equal(logoSrc('dor-alon'), null, 'the group\'s logo is not the shop\'s: the letter stays');
  for (const [k, u] of Object.entries(LOGOS)) assert.match(u, /^https:\/\/[a-z0-9.-]+\//, k);
  for (const [k, s] of Object.entries(SHOPS)) {
    for (const u of [s.order, s.search, s.paste].filter(Boolean)) assert.match(u, /^https:\/\//, k);
    if (s.search) assert.ok(s.search.includes('{q}'), k);
  }
  assert.equal(shopKey('a-online'), 'a');
});
