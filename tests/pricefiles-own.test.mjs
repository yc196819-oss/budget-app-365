import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseBlobList, haziList, superpharmList } = require('../server/pricefiles.js');

const reply = (status, body) => ({ ok: status < 400, status, arrayBuffer: async () => Buffer.from(body) });
const blob = (name, kb, at) => '<Blob><Name>' + name + '</Name><Properties><Last-Modified>' + at + '</Last-Modified><Content-Length>' + kb * 1024 + '</Content-Length></Properties></Blob>';
// Made-up file names and sizes.
const XML = '<?xml version="1.0"?><EnumerationResults><Blobs>'
  + blob('PriceFull7290700100008-001-202611130300.gz', 900, 'Fri, 13 Nov 2026 01:00:00 GMT')
  + blob('PriceFull7290700100008-002-202611130300.gz', 1200, 'Fri, 13 Nov 2026 01:05:00 GMT')
  + blob('PriceFull7290700100008-001-202611010300.gz', 800, 'Sun, 01 Nov 2026 01:00:00 GMT')
  + blob('Price7290700100008-001-202611130400.gz', 10, 'Fri, 13 Nov 2026 02:00:00 GMT')
  + blob('../bad name.gz', 1, 'Fri, 13 Nov 2026 02:00:00 GMT')
  + '</Blobs><NextMarker /></EnumerationResults>';

test('the file store\'s list: names, sizes and times; odd names are dropped', () => {
  const l = parseBlobList(XML);
  assert.equal(l.length, 4);
  assert.equal(l[1].size, 1200);
  assert.ok(l[1].at > l[0].at);
});

test('Hazi Hinam: when the shop page refuses us, the files come from the file store, newest day only', async () => {
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    if (url.startsWith('https://shop.hazi-hinam.co.il')) return reply(403, 'Forbidden');
    return reply(200, XML);
  };
  const list = await haziList(fetchFn, { id: '7290700100008' }, 'PriceFull');
  assert.deepEqual(list.map((f) => f.name), ['PriceFull7290700100008-002-202611130300.gz', 'PriceFull7290700100008-001-202611130300.gz']);
  assert.match(list[0].url, /^https:\/\/hazihinamprod01\.blob\.core\.windows\.net\/regulatories\/PriceFull/);
  assert.ok(asked.some((u) => /restype=container&comp=list&prefix=PriceFull/.test(u)));
});

test('Hazi Hinam: when both refuse, the shop\'s error is the one shown', async () => {
  const fetchFn = async (url) => reply(url.includes('hazi-hinam') ? 403 : 404, '');
  await assert.rejects(haziList(fetchFn, { id: '1' }, 'PriceFull'), /HTTP 403 shop\.hazi-hinam\.co\.il/);
});

test('Super-Pharm with no files says what the page held', async () => {
  const fetchFn = async () => reply(200, '<html><head><title>מחירים - דף חדש</title></head><body><a href="/files/x.gz">x</a><a href="/about">a</a></body></html>');
  await assert.rejects(superpharmList(fetchFn, {}, 'PriceFull'), (e) => /^no files: \d+KB, "מחירים - דף חדש", 2 links, e\.g\. \/files\/x\.gz/.test(e.message));
});
