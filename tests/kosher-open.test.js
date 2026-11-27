const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { readLabels, runBatch, empty } = require('../server/kosherOpen');

const domain = () => import(pathToFileURL(path.join(__dirname, '../public/app/src/domain/prices.js')).href);

test('reading Open Food Facts labels: our certifier, plain "kosher", nothing', async () => {
  const { certFromText } = await domain();
  assert.deepEqual(readLabels({ product: { labels_tags: ['en:kosher', 'he:בד-ץ-בית-יוסף'] } }, certFromText).cert, 'בד"ץ בית יוסף');
  assert.equal(readLabels({ product: { labels: 'Kosher, Badatz Edah Haredit' } }, certFromText).cert, 'בד"ץ העדה החרדית');
  const plain = readLabels({ product: { labels_tags: ['en:kosher'] } }, certFromText);
  assert.equal(plain.cert, null);
  assert.equal(plain.kosher, true, 'kosher, but no certifier named');
  assert.equal(readLabels({ product: { labels: 'Gluten free' } }, certFromText).kosher, false);
  assert.equal(readLabels({ status: 0 }, certFromText).found, false);
  // Only Open Food Facts' own photos are kept.
  assert.equal(readLabels({ product: { image_front_small_url: 'https://evil.example/x.jpg' } }, certFromText).image, '');
});

test('a batch: food only, each product asked once, a certifier kept, a failure retried next time', async () => {
  const { certFromText, kashrutFree } = await domain();
  const saved = new Map();
  const db = {
    todo: async () => [
      { barcode: '7290000000011', name: 'שוקולד חלב 100 גרם' },
      { barcode: '7290000000028', name: 'אקונומיקה 4 ליטר' },
      { barcode: '7290000000035', name: 'עגבניות' },
      { barcode: '7290000000042', name: 'פתיתים 500 גרם' },
      { barcode: '7290000000059', name: 'במבה 80 גרם' },
      { barcode: '7290000000066', name: 'קפה נמס 200 גרם' }
    ],
    save: async (code, row) => { saved.set(code, row); }
  };
  const asked = [];
  const answers = {
    '7290000000011': { status: 200, body: { product: { labels_tags: ['he:בד-ץ-העדה-החרדית'], image_front_small_url: 'https://images.openfoodfacts.org/a.jpg' } } },
    '7290000000042': { status: 200, body: { product: { labels_tags: ['en:kosher'] } } },
    '7290000000059': { status: 404, body: {} },
    '7290000000066': { status: 503, body: {} }
  };
  const fetchFn = async (url) => {
    const code = /product\/(\d+)\.json/.exec(url)[1];
    asked.push(code);
    const a = answers[code];
    return { ok: a.status === 200, status: a.status, json: async () => a.body };
  };
  const s = await runBatch({ db, fetchFn, certFromText, isFree: kashrutFree, limit: 10, gapMs: 0, state: empty() });
  assert.deepEqual(asked, ['7290000000011', '7290000000042', '7290000000059', '7290000000066'], 'cleaning and fresh vegetables are not asked');
  assert.equal(s.running, false);
  assert.equal(s.asked, 3);
  assert.equal(s.found, 2);
  assert.deepEqual(s.certs, { 'בד"ץ העדה החרדית': 1 });
  assert.equal(s.kosherNoCert, 1);
  assert.equal(s.missing, 1);
  assert.equal(s.failed, 1);
  assert.equal(saved.get('7290000000011').kosher_cert, 'בד"ץ העדה החרדית');
  assert.equal(saved.get('7290000000011').image_url, 'https://images.openfoodfacts.org/a.jpg');
  assert.equal(saved.get('7290000000042').kosher_cert, undefined, 'plain "kosher" is not a certifier');
  assert.ok(saved.get('7290000000059').image_checked_at, 'not in the database: not asked again');
  assert.ok(!saved.has('7290000000066'), 'a failure is not saved, so it is asked next time');
});

test('a batch stops at its limit, and a broken list is reported', async () => {
  const { certFromText } = await domain();
  const many = Array.from({ length: 9 }, (_, i) => ({ barcode: String(7290000001000 + i), name: 'מוצר ' + i }));
  let n = 0;
  const s = await runBatch({ db: { todo: async () => many, save: async () => {} }, fetchFn: async () => { n++; return { ok: true, status: 200, json: async () => ({}) }; }, certFromText, limit: 4, gapMs: 0, state: empty() });
  assert.equal(n, 4);
  assert.equal(s.asked, 4);
  const bad = await runBatch({ db: { todo: async () => { throw new Error('rpc missing'); }, save: async () => {} }, fetchFn: async () => ({}), certFromText, gapMs: 0, state: empty() });
  assert.equal(bad.error, 'rpc missing');
  assert.equal(bad.running, false);
});
