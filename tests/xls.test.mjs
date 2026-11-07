import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readXls, parseBiff, XlsError } from '../public/app/src/lib/xls.js';
import { rowsToTransactions } from '../public/app/src/domain/statement.js';

// The two files were saved as "Excel 97-2003" by LibreOffice, with made-up
// data: small.xls is tiny (its workbook sits in the file's mini sectors);
// statement.xls has 250 lines, so its strings table spans several records.
const fixture = (name) => {
  const b = readFileSync(new URL('./fixtures/xls/' + name, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};

test('a small .xls: sheet name, Hebrew text, negative and whole numbers', () => {
  const sheets = readXls(fixture('small.xls'));
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, 'קטן');
  assert.deepEqual(sheets[0].rows, [['שופרסל דמו', -12.5, 3, 4]]);
});

test('a 250-line .xls statement: every line, every name, the exact total', () => {
  const sheets = readXls(fixture('statement.xls'));
  assert.deepEqual(sheets.map((s) => s.name), ['עסקאות', 'שני']);
  const rows = sheets[0].rows;
  assert.deepEqual(rows[1], ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב', 'הערה']);
  const lines = rows.slice(2, 252);
  lines.forEach((r, i) => {
    assert.equal(r[1], 'חנות דמיונית מספר ' + i);
    assert.equal(r[3], 'הערה ' + i);
  });
  // Dates arrive as Excel day numbers (2026-01-01 is 46023).
  assert.equal(lines[0][0], 46023);
  const sum = lines.reduce((s, r) => s + r[2], 0);
  // The last line holds formulas: their saved results are read.
  const last = rows[252];
  assert.equal(last[0], 'סה"כ');
  assert.equal(Math.round(sum * 100), Math.round(last[2] * 100));
  assert.equal(last[3], true);
  assert.deepEqual(sheets[1].rows, [[7]]);
});

test('the importer finds the transactions in an .xls statement', () => {
  const rows = readXls(fixture('statement.xls')).flatMap((s) => s.rows);
  const items = rowsToTransactions(rows);
  assert.equal(items.length, 250);
  assert.equal(items[0].description, 'חנות דמיונית מספר 0');
  assert.equal(items[0].amount, 78);
  assert.equal(items[0].date, '2026-01-01');
});

test('a file that is not an .xls fails with a format error', () => {
  const bytes = new Uint8Array(600);
  assert.throws(() => readXls(bytes.buffer), (e) => e instanceof XlsError && e.code === 'format');
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  assert.throws(() => readXls(ole.buffer), (e) => e instanceof XlsError);
});

// Hand-made BIFF records, for the cell kinds LibreOffice does not write.
function rec(type, bytes) {
  const out = new Uint8Array(4 + bytes.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, type, true);
  v.setUint16(2, bytes.length, true);
  out.set(bytes, 4);
  return out;
}
const le = (...parts) => {
  const out = [];
  for (const [n, size] of parts) for (let i = 0; i < size; i++) out.push((n >>> (8 * i)) & 0xff);
  return out;
};
function biff(cells, { password = false } = {}) {
  const bof = rec(0x0809, le([0x0600, 2], [0x0005, 2], [0, 4], [0, 8]));
  const sheetBof = rec(0x0809, le([0x0600, 2], [0x0010, 2], [0, 4], [0, 8]));
  const eof = rec(0x000a, []);
  const name = [...'גיליון'].flatMap((c) => le([c.charCodeAt(0), 2]));
  const globals = [bof, ...(password ? [rec(0x002f, le([0, 2]))] : [])];
  const boundLen = 4 + 6 + 2 + name.length;
  const sheetAt = globals.reduce((s, r) => s + r.length, 0) + boundLen + eof.length;
  const bound = rec(0x0085, [...le([sheetAt, 4], [0, 1], [0, 1], [6, 1], [1, 1]), ...name]);
  const parts = [...globals, bound, eof, sheetBof, ...cells, eof];
  const out = new Uint8Array(parts.reduce((s, r) => s + r.length, 0));
  let p = 0;
  for (const r of parts) { out.set(r, p); p += r.length; }
  return out;
}
const f64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n, true); return [...b]; };

test('RK and MULRK numbers, text cells, booleans and a text formula', () => {
  const rkInt = (n) => (n << 2) | 2;
  const rkCents = (n) => (n << 2) | 3; // a whole number of hundredths
  const text = [...'דלק'].flatMap((c) => le([c.charCodeAt(0), 2]));
  const sheets = parseBiff(biff([
    rec(0x027e, le([0, 2], [0, 2], [15, 2], [rkInt(-40), 4])),
    rec(0x00bd, le([1, 2], [0, 2], [15, 2], [rkCents(12345), 4], [15, 2], [rkInt(7), 4], [1, 2])),
    rec(0x0204, [...le([2, 2], [1, 2], [15, 2], [3, 2], [1, 1]), ...text]),
    rec(0x0203, [...le([2, 2], [2, 2], [15, 2]), ...f64(99.9)]),
    rec(0x0205, le([3, 2], [0, 2], [15, 2], [1, 1], [0, 1])),
    rec(0x0006, [...le([3, 2], [1, 2], [15, 2], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0xffff, 2], [0, 2], [0, 4], [0, 2])]),
    rec(0x0207, [...le([3, 2], [1, 1]), ...text])
  ]));
  assert.equal(sheets[0].name, 'גיליון');
  assert.deepEqual(sheets[0].rows, [[-40], [123.45, 7], ['', 'דלק', 99.9], [true, 'דלק']]);
});

test('a file locked with a password says so', () => {
  assert.throws(() => parseBiff(biff([], { password: true })), (e) => e instanceof XlsError && e.code === 'password');
});
