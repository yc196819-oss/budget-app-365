import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { CHAINS, probeOne, probeAll } = createRequire(import.meta.url)('../server/prices.js');

test('every chain site is https and has a Hebrew name', () => {
  assert.ok(CHAINS.length >= 8);
  for (const c of CHAINS) { assert.match(c.url, /^https:\/\//); assert.match(c.name, /[א-ת]/); }
});

test('a site that answers, one that refuses, one that is down, one that hangs', async () => {
  const fake = async (url, { signal }) => {
    if (url.includes('a.test')) return { status: 200 };
    if (url.includes('b.test')) return { status: 403 };
    if (url.includes('c.test')) { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }
    return new Promise((_r, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  };
  const out = await probeAll(fake, [
    { key: 'a', name: 'א', url: 'https://a.test/' }, { key: 'b', name: 'ב', url: 'https://b.test/' },
    { key: 'c', name: 'ג', url: 'https://c.test/' }, { key: 'd', name: 'ד', url: 'https://d.test/' }
  ], 50);
  assert.deepEqual(out.map((r) => [r.key, r.ok, r.status, r.error || '']), [['a', true, 200, ''], ['b', false, 403, ''], ['c', false, 0, 'ENOTFOUND'], ['d', false, 0, 'timeout']]);
  assert.equal((await probeOne(CHAINS[0], async () => ({ status: 301 }))).ok, true);
});

const { apifyAbout, apifySample } = createRequire(import.meta.url)('../server/prices.js');

test('the outside price service: what it takes and costs, read from the service itself; the key goes in a header', async () => {
  const seen = [];
  const fake = async (url, opts) => {
    seen.push([url, opts.headers.Authorization]);
    if (url.endsWith('/acts/swerve~supermarket-prices')) return { ok: true, json: async () => ({ data: { title: 'Prices', description: 'Official price files', modifiedAt: '2026-10-01', taggedBuilds: { latest: { buildId: 'b1' } }, exampleRunInput: { body: '{"query":"חלב"}' }, pricingInfos: [{ pricingModel: 'PAY_PER_EVENT', pricingPerEvent: { actorChargeEvents: { result: { eventPriceUsd: 0.002 } } } }] } }) };
    if (url.endsWith('/actor-builds/b1')) return { ok: true, json: async () => ({ data: { inputSchema: JSON.stringify({ properties: { query: { title: 'Product', type: 'string', prefill: 'חלב' }, chains: { title: 'Chains', type: 'array', enum: ['shufersal', 'rami-levy'] } } }) } }) };
    return { ok: false, status: 404, json: async () => ({ error: { message: 'no' } }) };
  };
  const a = await apifyAbout(fake, 'tok');
  assert.equal(a.title, 'Prices');
  assert.deepEqual(a.example, { query: 'חלב' });
  assert.deepEqual(a.fields.map((f) => [f.key, f.example]), [['query', 'חלב'], ['chains', ['shufersal', 'rami-levy']]]);
  assert.equal(a.pricing.model, 'PAY_PER_EVENT');
  assert.ok(seen.every(([url, auth]) => auth === 'Bearer tok' && !url.includes('tok')), 'never in the address');
});

test('one small run: capped, the fields and a few rows as they came; a refusal is explained', async () => {
  let asked = '';
  const ok = async (url, opts) => { asked = url + ' ' + opts.body; return { ok: true, text: async () => JSON.stringify([{ chain: 'שופרסל', store: 'דיזנגוף', item: 'חלב 3%', price: 6.9, updated: '2026-11-08T05:00:00Z', extra: { a: 1 } }]) }; };
  const s = await apifySample(ok, 'tok', { query: 'חלב' });
  assert.match(asked, /maxItems=15/);
  assert.match(asked, /"query":"חלב"/);
  assert.equal(s.count, 1);
  assert.deepEqual(s.keys, ['chain', 'store', 'item', 'price', 'updated', 'extra']);
  assert.equal(s.rows[0].price, '6.9');
  assert.equal(s.rows[0].extra, '{"a":1}');
  const no = async () => ({ ok: false, status: 402, text: async () => JSON.stringify({ error: { message: 'Not enough credit' } }) });
  await assert.rejects(apifySample(no, 'tok', {}), /402: Not enough credit/);
});

const { apifyStart, apifyCheck, SAMPLE_INPUT } = createRequire(import.meta.url)('../server/prices.js');

test('a test search is started, then checked until done, with the fields the service lists', async () => {
  assert.deepEqual(SAMPLE_INPUT.productQueries, ['חלב 3%']);
  assert.equal(SAMPLE_INPUT.mode, 'compareProducts');
  assert.equal(SAMPLE_INPUT.includeImages, false);
  let started = '';
  const start = await apifyStart(async (url, opts) => { started = url + ' ' + opts.body + ' ' + opts.headers.Authorization; return { ok: true, json: async () => ({ data: { id: 'run123abc', status: 'RUNNING' } }) }; }, 'tok', SAMPLE_INPUT);
  assert.deepEqual(start, { runId: 'run123abc', status: 'RUNNING' });
  assert.match(started, /\/runs\?timeout=300 .*"productQueries":\["חלב 3%"\].* Bearer tok$/);
  let runStatus = 'RUNNING';
  const fake = async (url) => {
    if (url.includes('/actor-runs/run123abc')) return { ok: true, json: async () => ({ data: { status: runStatus, startedAt: '2026-11-08T10:00:00Z', finishedAt: runStatus === 'SUCCEEDED' ? '2026-11-08T10:00:40Z' : null, defaultDatasetId: 'ds1', usageTotalUsd: 0.012 } }) };
    if (url.includes('/datasets/ds1/items')) return { ok: true, json: async () => [{ chain: 'shufersal', name: 'חלב 3%', barcode: '7290000000001', price: 6.9 }] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const running = await apifyCheck(fake, 'tok', 'run123abc');
  assert.equal(running.done, false);
  runStatus = 'SUCCEEDED';
  const done = await apifyCheck(fake, 'tok', 'run123abc');
  assert.equal(done.done, true);
  assert.equal(done.seconds, 40);
  assert.equal(done.count, 1);
  assert.deepEqual(done.keys, ['chain', 'name', 'barcode', 'price']);
  await assert.rejects(apifyCheck(fake, 'tok', '../x'), /bad run/);
});

const { catalogRows, fetchInput, SEED, apifyItems } = createRequire(import.meta.url)('../server/prices.js');

test('rows from the price service become one product per barcode and the lowest price per chain', () => {
  // Made-up rows in the shape the service returns.
  const rows = [
    { barcode: '7290000000011', itemName: 'חלב 3% שקית 1 ל', manufacturer: 'מחלבה א', quantity: 1, unitQty: 'ליטר', price: 6.4, chainKey: 'x', chainName: 'רשת א' },
    { barcode: '7290000000011', itemName: 'חלב שקית 3% 1 ליטר', manufacturer: '---', quantity: 1000, unitQty: 'מיליליטר', price: 6.1, chainKey: 'x', chainName: 'רשת א' },
    { barcode: '7290000000011', itemName: 'חלב 3% שקית 1 ל', manufacturer: '', price: 6.9, chainKey: 'y', chainName: 'רשת ב' },
    { barcode: 'abc', itemName: 'בלי ברקוד', price: 3, chainKey: 'x' },
    { barcode: '7290000000028', itemName: 'מחיר שגוי', price: 0, chainKey: 'x' },
    { barcode: '7290000000035', itemName: '', price: 4, chainKey: 'x' }
  ];
  const { products, offers } = catalogRows(rows, new Date('2026-03-10T12:00:00Z'));
  assert.equal(products.length, 1);
  assert.deepEqual(products[0], { barcode: '7290000000011', name: 'חלב שקית 3% 1 ליטר', names: 'חלב שקית 3% 1 ליטר | חלב 3% שקית 1 ל', maker: 'מחלבה א', qty: 1, unit: 'ליטר', seen_at: '2026-03-10T12:00:00.000Z' });
  assert.deepEqual(offers.map((o) => [o.chain, o.price]), [['x', 6.1], ['y', 6.9]]);
  assert.deepEqual(catalogRows(null), { products: [], offers: [] });
});

test('a chain that cuts names short does not win: the longest name is the product name', () => {
  const rows = [
    { barcode: '7290000000042', itemName: 'יוגורט פירות מוצק', price: 5, chainKey: 'x' },
    { barcode: '7290000000042', itemName: 'יוגורט פירות מוצק', price: 5.2, chainKey: 'y' },
    { barcode: '7290000000042', itemName: 'יוגורט פירות מוצק 3% 150 גרם', price: 5.5, chainKey: 'z' }
  ];
  assert.equal(catalogRows(rows).products[0].name, 'יוגורט פירות מוצק 3% 150 גרם');
});

test('what is asked of the service: at most 15 cleaned items, no repeats, a size cap', () => {
  const input = fetchInput(['חלב', ' חלב ', '<b>ביצים</b>', 'x', ...Array.from({ length: 30 }, (_, i) => 'מוצר ' + i)]);
  assert.equal(input.productQueries.length, 15);
  assert.deepEqual(input.productQueries.slice(0, 2), ['חלב', 'bביצים/b']);
  assert.equal(input.mode, 'compareProducts');
  assert.equal(input.oneStorePerChain, true);
  assert.ok(input.maxItems <= 2000);
  assert.equal(fetchInput(['', 'a']), null);
  assert.ok(SEED.length >= 60 && SEED.every((q) => /[א-ת]/.test(q)));
});

test('a finished run gives all its rows; a running one none', async () => {
  const fake = async (url) => ({ ok: true, json: async () => (url.includes('/actor-runs/') ? { data: url.includes('run2') ? { status: 'RUNNING' } : { status: 'SUCCEEDED', defaultDatasetId: 'ds1', usageTotalUsd: 0.02 } } : [{ barcode: '1' }, { barcode: '2' }]) });
  const done = await apifyItems(fake, 't', 'run1abc');
  assert.equal(done.done, true);
  assert.equal(done.items.length, 2);
  assert.equal(done.cost, 0.02);
  assert.equal((await apifyItems(fake, 't', 'run2abc')).done, false);
  await assert.rejects(apifyItems(fake, 't', '../x'));
});

test('the catalog load: one name a run at two chains, then the leading barcodes at the main chains, with a cost estimate', async () => {
  const p = (await import('module')).createRequire(import.meta.url)('../server/prices.js');
  const f = p.findInput('חלב 3%');
  assert.deepEqual(f.productQueries, ['חלב 3%']);
  assert.deepEqual(f.chains, ['shufersal', 'rami-levy']);
  assert.equal(f.maxRowsPerChain, 3, 'the cap covers one name only');
  assert.equal(p.findInput('<>'), null);
  // Found at both chains first, then the rest; at most 3 for one name.
  const items = [{ barcode: '1111', chainKey: 'shufersal' }, { barcode: '2222', chainKey: 'shufersal' }, { barcode: '2222', chainKey: 'rami-levy' }, { barcode: '3333', chainKey: 'shufersal' }, { barcode: '4444', chainKey: 'shufersal' }, { barcode: 'x', chainKey: 'shufersal' }];
  assert.deepEqual(p.leadBarcodes(items, 1), ['2222', '1111', '3333']);
  const c = p.compareInput(['2222', '1111', '2222', 'bad']);
  assert.deepEqual(c.barcodes, ['2222', '1111']);
  assert.equal(c.chains.length, p.MAIN_CHAINS.length);
  assert.equal(c.maxRowsPerChain, 2);
  assert.equal(c.maxItems, 2 * p.MAIN_CHAINS.length);
  assert.equal(p.compareInput([]), null);
  // 83 names, 3 each, at 2 + 10 chains, $0.002 a row: at most about $6.
  assert.ok(p.loadCost(83) <= 6 && p.loadCost(83) > 5);
});

test('a chain\'s own price file: real barcodes only, with name, maker, size and price', async () => {
  const { parsePriceFile } = createRequire(import.meta.url)('../server/pricefiles.js');
  const xml = `<Root><ChainID>1</ChainID><Items>
    <Item><ItemCode>7290000000017</ItemCode><ItemName>חלב בדוי 3% 1 ליטר</ItemName><ManufactureName>מחלבה בדויה</ManufactureName><Quantity>1.00</Quantity><UnitOfMeasure>ליטר</UnitOfMeasure><ItemPrice>6.90</ItemPrice></Item>
    <Item><ItemCode>123</ItemCode><ItemName>קוד פנימי</ItemName><ItemPrice>5</ItemPrice></Item>
    <Item><ItemCode>7290000000024</ItemCode><ItemName>חטיף &quot;בדוי&quot;</ItemName><ManufactureName>יצרן</ManufactureName><Quantity>1.32</Quantity><UnitQty>לא ידוע</UnitQty><ItemPrice>0</ItemPrice></Item>
    <Item><ItemCode>7290000000031</ItemCode><ItemName>ביצים &amp; עוד</ItemName><Quantity>12</Quantity><UnitQty>לא ידוע</UnitQty><ItemPrice>14.90</ItemPrice></Item>
  </Items></Root>`;
  const rows = parsePriceFile(xml, { key: 'x', name: 'רשת בדויה' });
  assert.deepEqual(rows.map((r) => r.barcode), ['7290000000017', '7290000000031'], 'no short codes, no zero prices');
  assert.deepEqual(rows[0], { barcode: '7290000000017', itemName: 'חלב בדוי 3% 1 ליטר', manufacturer: 'מחלבה בדויה', quantity: 1, unitQty: 'ליטר', price: 6.9, chainKey: 'x', chainName: 'רשת בדויה' });
  assert.equal(rows[1].itemName, 'ביצים & עוד');
  assert.equal(rows[1].unitQty, '', '"לא ידוע" is no unit');
  // Into the catalog: one product, its price at this chain.
  const { catalogRows } = createRequire(import.meta.url)('../server/prices.js');
  const c = catalogRows(rows);
  assert.equal(c.products.length, 2);
  assert.deepEqual(c.offers.map((o) => [o.barcode, o.chain, o.price]), [['7290000000017', 'x', 6.9], ['7290000000031', 'x', 14.9]]);
});

test('the second shared price site: the newest full price file, a small branch passed over, links only on the chain\'s own site', async () => {
  const { bina, BINA, CHAINS } = createRequire(import.meta.url)('../server/pricefiles.js');
  const zlib = await import('node:zlib');
  const item = (code, price) => `<Item><ItemCode>${code}</ItemCode><ItemName>מוצר בדוי ${code}</ItemName><ItemPrice>${price}</ItemPrice></Item>`;
  const big = '<Root><Items>' + Array.from({ length: 600 }, (_, i) => item(7290000100000 + i, 5)).join('') + '</Items></Root>';
  const small = '<Root><Items>' + item(7290000200001, 3) + '</Items></Root>';
  const chain = { key: 'test', name: 'רשת בדויה', host: 'example', id: '7290000000000' };
  const base = 'https://example.binaprojects.com';
  const asked = [];
  const site = (link = (n) => base + '/Download/' + n) => async (url) => {
    asked.push(url);
    const body = (s) => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(s) });
    if (url.startsWith(base + '/MainIO_Hok.aspx?')) return body(JSON.stringify([{ FileNm: 'Promo7290000000000-001-20261110-0500.gz' }, { FileNm: 'PriceFull7290000000000-000-001-20261109-050000.GZ' }, { FileNm: 'PriceFull7290000000000-000-002-20261110-050000.GZ' }, { FileNm: 'PriceFull7290000000000-000-003-20261110-040000.GZ' }]));
    if (url.startsWith(base + '/Download.aspx?FileNm=')) return body(JSON.stringify([{ SPath: link(decodeURIComponent(url.split('=')[1])) }]));
    if (url.includes('-002-')) return body(zlib.gzipSync(small));
    if (url.includes('-003-')) return body(zlib.gzipSync(big));
    return { ok: false, status: 404, arrayBuffer: async () => Buffer.from('') };
  };
  const rows = await bina(site(), chain);
  assert.equal(rows.length, 600, 'the small newest branch is passed over for the next');
  assert.ok(asked[0].includes('_=7290000000000') && asked[0].includes('WFileType=4'));
  assert.ok(asked.some((u) => u.endsWith('-002-20261110-050000.GZ')), 'the newest first');
  assert.equal(rows[0].chainName, 'רשת בדויה');
  // A link to anywhere else is not followed.
  await assert.rejects(bina(site((n) => 'https://elsewhere.example/' + n), chain), /no file link/);
  // Every chain has its own key; the free load goes over all of them.
  assert.equal(new Set(CHAINS.map((c) => c.key)).size, CHAINS.length);
  assert.ok(BINA.some((c) => c.name === 'שפע ברכת השם'));
});

test('a chain with a password is loaded only when its password is in the server settings, never from the code', () => {
  const { CERBERUS, CHAINS } = createRequire(import.meta.url)('../server/pricefiles.js');
  const locked = CERBERUS.filter((c) => c.passEnv);
  assert.deepEqual(locked.map((c) => c.key), ['yellow', 'super-yuda']);
  for (const c of locked) {
    assert.equal(c.pass, undefined, 'no password written in the code');
    assert.equal(CHAINS.some((x) => x.key === c.key), !!process.env[c.passEnv]);
  }
});
