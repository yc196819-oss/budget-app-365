import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readXlsx, parseSheet, parseSharedStrings } from '../public/app/src/lib/xlsx.js';
import { makeXlsx, makeZip } from './fixtures/zip.mjs';

test('reads sheet names, strings and numbers from an xlsx file', async () => {
  const buf = makeXlsx([['פירוט עסקאות'], ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'], [46249, 'שופרסל דיל', 245.9]]);
  const sheets = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, 'עסקאות');
  assert.deepEqual(sheets[0].rows, [['פירוט עסקאות'], ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'], [46249, 'שופרסל דיל', 245.9]]);
});

test('keeps empty cells in place using the cell reference', () => {
  const rows = parseSheet('<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1"><v>3</v></c></row><row r="2"/>', []);
  assert.deepEqual(rows, [['a', '', 3], []]);
});

test('shared strings: rich text pieces are joined and entities decoded', () => {
  assert.deepEqual(parseSharedStrings('<sst><si><r><t>A&amp;</t></r><r><t xml:space="preserve"> B</t></r></si><si><t>&#1513;</t></si></sst>'), ['A& B', 'ש']);
});

test('formula cells give their cached value; booleans become true/false', () => {
  const rows = parseSheet('<row r="1"><c r="A1" t="str"><f>A2</f><v>x</v></c><c r="B1" t="b"><v>1</v></c><c r="C1"><f>1+1</f><v>2</v></c></row>', []);
  assert.deepEqual(rows, [['x', true, 2]]);
});

test('falls back to worksheet files when the workbook lists none', async () => {
  const buf = makeZip({ 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>' });
  const sheets = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  assert.deepEqual(sheets[0].rows, [[7]]);
});

test('a file that is not a zip is rejected', async () => {
  await assert.rejects(readXlsx(new TextEncoder().encode('hello world, not a zip at all').buffer), /zip/);
});
