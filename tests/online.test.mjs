import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { nearby, withoutChains, chainNote, isOnlineChain, baseChain, bestAlways, twoChains } from '../public/app/src/domain/prices.js';
import { promoCost } from '../public/app/src/domain/promos.js';
const require = createRequire(import.meta.url);
const online = require('../server/online.js');
const { nearestStores } = require('../server/area.js');
const { gunzip, parsePriceFile } = require('../server/pricefiles.js');

test('online: a branch named as the online shop is one, a kiosk that delivers is not', () => {
  assert.ok(online.isOnline('מרלוג אינטרנט'));
  assert.ok(online.isOnline('שופרסל ONLINE'));
  assert.ok(online.isOnline('און ליין - ראש פינה'));
  assert.ok(!online.isOnline('עין שמר משלוחים'));
  assert.ok(online.isOnline('וולט- ת"א דיזינגוף סנטר'), 'a delivery-app branch');
  assert.deepEqual(online.onlineStores([{ chain: 'a', store_id: '39', name: 'מרלוג אינטרנט' }, { chain: 'a', store_id: '1', name: 'סניף' }]), { a: ['39'] });
  assert.equal(online.onlineKey('rami-levy'), 'rami-levy-online');
  assert.equal(online.onlineName('רמי לוי'), 'רמי לוי אונליין');
  assert.deepEqual(online.asOnline([{ barcode: '1', chainKey: 'a', chainName: 'א' }], { key: 'a', name: 'א' })[0], { barcode: '1', chainKey: 'a-online', chainName: 'א אונליין' });
});

test('online: an online warehouse is never the branch near the family', () => {
  const stores = [{ chain: 'a', store_id: '39', name: 'מרלוג אינטרנט', address: '', city: 'בית שמש' }, { chain: 'a', store_id: '5', name: 'סניף העיר', address: '', city: 'בית שמש' }];
  const near = nearestStores(stores, { code: '2610' });
  assert.deepEqual(near.map((s) => s.store_id), ['5']);
});

test('online: a zipped price file (not gzipped) is read, with the short field names', () => {
  const xml = '<Root><Items><Item><ItemCode>7290000000011</ItemCode><ItemNm>חלב 3%</ItemNm><ItemPrice>6.2</ItemPrice><Quantity>1</Quantity><UnitQty>ליטר</UnitQty></Item></Items></Root>';
  const data = zlib.deflateRawSync(Buffer.from(xml));
  const name = Buffer.from('PriceFull.xml');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(8, 8); head.writeUInt32LE(data.length, 18); head.writeUInt16LE(name.length, 26);
  const rows = parsePriceFile(gunzip(Buffer.concat([head, name, data])), { key: 'a', name: 'א' });
  assert.deepEqual(rows.map((r) => [r.barcode, r.itemName, r.price]), [['7290000000011', 'חלב 3%', 6.2]]);
});

test('online: compared as a chain of its own, everywhere, with what to know', () => {
  const cat = { 'חלב': [{ barcode: '1', name: 'חלב', offers: [{ chain: 'a', price: 6 }, { chain: 'a-online', price: 5.5 }, { chain: 'far', price: 4 }] }] };
  assert.deepEqual(nearby(cat, true, [{ chain: 'a' }])['חלב'][0].offers.map((o) => o.chain), ['a', 'a-online'], 'online is not near or far');
  assert.deepEqual(withoutChains(cat, ['a'])['חלב'][0].offers.map((o) => o.chain), ['far'], 'a chain left out is left out online too');
  assert.ok(isOnlineChain('a-online'));
  assert.equal(baseChain('a-online'), 'a');
  assert.match(chainNote('rami-levy-online').text, /כולל משלוח של ₪35.90/);
  assert.equal(bestAlways([{ chain: 'a-online', missing: 0, total: 50 }, { chain: 'a', name: 'א', missing: 0, total: 52 }]).chain, 'a', 'cheapest online: the cheapest shop is named too');
  assert.equal(twoChains([{ chain: 'a-online', missing: 0, total: 50, lines: [] }]), null);
});

test('online: a chain\'s club counts in its online shop too', () => {
  const club = { need: 1, unit_price: 4, everyone: false, club: 'club', coupon: false, min_buy: 0 };
  assert.equal(promoCost({ chain: 'a-online', price: 6, promos: [club] }, 1, new Date('2026-11-13'), new Set(['a:club'])).cost, 4);
});

test('online: the delivery is part of what the list costs there', async () => {
  const { basket, deliveryOf } = await import('../public/app/src/domain/prices.js');
  const milk = { barcode: '1', name: 'חלב 1 ליטר', qty: 1, unit: 'ליטר', offers: [{ chain: 'rami-levy-online', chain_name: 'רמי לוי אונליין', price: 5 }, { chain: 'rami-levy', chain_name: 'רמי לוי', price: 6 }] };
  const rows = basket([{ id: 'a', pick: milk, pool: [milk] }], () => 10);
  const on = rows.find((r) => r.chain === 'rami-levy-online');
  assert.equal(on.total, 85.9, 'ten milks at ₪5 and the delivery');
  assert.deepEqual(on.delivery, { fee: 35.9, sure: true });
  assert.equal(rows[0].chain, 'rami-levy', 'the shop is cheaper once the delivery is counted');
  assert.equal(deliveryOf('shuk-hair-online').sure, false, 'not confirmed: said as about');
  assert.equal(deliveryOf('rami-levy'), null);
});

test('online on the server: kept apart from the shop, and not retried on its own', () => {
  const prices = require('../server/prices.js');
  assert.deepEqual(prices.retryLater([{ key: 'a', error: 'fetch failed' }, { key: 'a-online', error: 'fetch failed', online: true }]), ['a']);
  const r = prices.catalogRows([{ barcode: '7290000000011', itemName: 'חלב', price: 5, chainKey: 'rami-levy-online', chainName: 'רמי לוי אונליין' }, { barcode: '7290000000011', itemName: 'חלב', price: 6, chainKey: 'rami-levy', chainName: 'רמי לוי' }]);
  assert.deepEqual(r.offers.map((o) => [o.chain, o.price]).sort(), [['rami-levy', 6], ['rami-levy-online', 5]]);
});

test('online: a delivery price not confirmed for a chain is said as about', () => {
  assert.match(chainNote('rami-levy-online').text, /כולל משלוח של ₪35\.90\./);
  assert.match(chainNote('shuk-hair-online').text, /בערך ₪35\.90 \(לא אימתנו/);
});

test('the saving said is against the middle of the chains, not the dearest', async () => {
  const { saving } = await import('../public/app/src/domain/prices.js');
  const r = (total) => ({ missing: 0, total });
  assert.equal(saving([r(100), r(110), r(120), r(200)]), 15, 'the middle of 100, 110, 120, 200 is 115');
  assert.equal(saving([r(100), r(110), r(300)]), 10);
  assert.equal(saving([r(100), r(108)]), 8, 'two chains: the difference');
  assert.equal(saving([r(100)]), 0);
});
