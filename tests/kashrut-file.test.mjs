import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, csvRows, readFilled, preselected, batches } from '../public/app/src/domain/kashrutFile.js';

test('the list to fill: a header, one row a product, quotes where needed, Excel reads the Hebrew', () => {
  const csv = toCsv([{ barcode: '7290000000011', name: 'שוקולד "חלב", 100 גרם', maker: 'יצרן א', chains: 28 }, { barcode: '7290000000028', name: 'פתיתים', maker: '', chains: null }]);
  assert.ok(csv.startsWith('﻿#,barcode,name,maker,chains\r\n'));
  const rows = csvRows(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['1', '7290000000011', 'שוקולד "חלב", 100 גרם', 'יצרן א', '28']);
  assert.deepEqual(rows[2], ['2', '7290000000028', 'פתיתים', '', '']);
});

test('the filled file back: known certifiers kept with their source, "unknown" counted, the rest reported', () => {
  const text = [
    'barcode,kashrut,source_url,confidence,notes',
    '7290000000011,בד"ץ בית יוסף,https://example.com/a,high,"על האריזה, גם רבנות"',
    '7290000000028,רבנות,https://example.com/b,medium,',
    '7290000000035,לא ידוע,,low,לא נמצא',
    '7290000000042,OU,https://example.com/c,high,',
    'abc,רבנות,https://example.com/d,high,',
    '7290000000059,רבנות מהדרין,,low,רק לפי השם',
    '7290000000011,רבנות,https://example.com/e,high,כפול',
    '7290000000066,בד״ץ העדה החרדית,https://example.com/f,HIGH,'
  ].join('\n');
  const d = readFilled(text);
  assert.deepEqual(d.rows.map((r) => [r.barcode, r.cert]), [
    ['7290000000011', 'בד"ץ בית יוסף'], ['7290000000028', 'רבנות'], ['7290000000059', 'רבנות מהדרין'], ['7290000000066', 'בד"ץ העדה החרדית']
  ], 'the first answer for a barcode wins; Hebrew quote marks read as plain ones');
  assert.equal(d.rows[0].notes, 'על האריזה, גם רבנות');
  assert.equal(d.rows[3].confidence, 'high');
  assert.equal(d.unknown, 1);
  assert.deepEqual(d.bad.map((b) => b.line), [5, 6]);
  assert.match(d.bad[0].why, /OU/);
  // Checked from the start: a source, and not low.
  assert.deepEqual(d.rows.filter(preselected).map((r) => r.barcode), ['7290000000011', '7290000000028', '7290000000066']);
});

test('a file without the needed columns, an unsafe link, and saving by certifier in batches of 200', () => {
  assert.equal(readFilled('a,b\n1,2').bad.length, 1);
  const d = readFilled('barcode,kashrut,source_url,confidence\n7290000000011,רבנות,javascript:alert(1),high');
  assert.equal(d.rows[0].source, '', 'only web links');
  assert.equal(preselected(d.rows[0]), false);
  const many = Array.from({ length: 250 }, (_, i) => ({ barcode: String(7290000100000 + i), cert: 'רבנות' }));
  const b = batches([...many, { barcode: '1234', cert: 'הרב לנדא' }]);
  assert.deepEqual(b.map((x) => [x.cert, x.barcodes.length]), [['רבנות', 200], ['רבנות', 50], ['הרב לנדא', 1]]);
});
