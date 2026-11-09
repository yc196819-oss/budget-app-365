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
