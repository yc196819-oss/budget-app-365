// The kashrut list as a file, out and back in: the owner downloads the
// products whose kashrut is unknown, someone (or an AI with web search)
// fills in the certifier with a source, and the filled file is read back for
// the owner to check before anything is saved. Pure.
import { isCert } from './prices.js';

export const UNKNOWN = 'לא ידוע';
const LEVELS = ['high', 'medium', 'low'];

// One field of a CSV row, quoted when it has to be.
const field = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// The list to fill: one row a product, the same columns the prompt asks for
// back, with a BOM so Excel reads the Hebrew.
export function toCsv(products) {
  const head = ['#', 'barcode', 'name', 'maker', 'chains'];
  const lines = (products || []).map((p, i) => [i + 1, p.barcode, p.name, p.maker || '', p.chains ?? ''].map(field).join(','));
  return '﻿' + [head.join(','), ...lines].join('\r\n') + '\r\n';
}

// CSV text to rows of fields (quotes, commas and line breaks inside quotes).
export function csvRows(text) {
  const t = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur === '') q = true;
    // (A quote inside an unquoted field is part of it: בד"ץ.)
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

// The barcodes of a list already handed out (filled or not): its barcode
// column, or every long number when the file has no header we know.
export function sentBarcodes(text) {
  const rows = csvRows(text);
  const ib = rows.length ? rows[0].map((h) => h.trim().toLowerCase()).findIndex((h) => h === 'barcode' || h === 'ברקוד') : -1;
  const cells = ib >= 0 ? rows.slice(1).map((r) => r[ib]) : rows.flat();
  return [...new Set(cells.map((c) => String(c || '').replace(/\D/g, '')).filter((c) => /^[0-9]{8,20}$/.test(c)))];
}

// The filled file back: rows with a certifier we know (or "לא כשר"), ready
// for the owner to check. Unknown answers and anything that does not read
// are counted, never guessed. The source and confidence come along to show.
export function readFilled(text) {
  const rows = csvRows(text);
  const out = { rows: [], unknown: 0, bad: [] };
  if (!rows.length) return out;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const ib = col('barcode'), ik = col('kashrut');
  if (ib < 0 || ik < 0) { out.bad.push({ line: 1, why: 'חסרות העמודות barcode ו-kashrut' }); return out; }
  const iu = col('source_url'), ic = col('confidence'), inote = col('notes'), iname = col('name');
  const seen = new Set();
  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const barcode = String(r[ib] || '').replace(/\D/g, '');
    const cert = String(r[ik] || '').trim().replace(/[״“”]/g, '"');
    if (!/^[0-9]{4,20}$/.test(barcode)) { out.bad.push({ line, why: 'ברקוד לא תקין' }); return; }
    if (!cert || cert === UNKNOWN) { out.unknown++; return; }
    if (!isCert(cert)) { out.bad.push({ line, barcode, why: 'כשרות שלא ברשימה: ' + cert.slice(0, 40) }); return; }
    if (seen.has(barcode)) return;
    seen.add(barcode);
    const url = iu >= 0 ? String(r[iu] || '').trim() : '';
    const conf = ic >= 0 ? String(r[ic] || '').trim().toLowerCase() : '';
    out.rows.push({
      barcode, cert,
      source: /^https?:\/\//i.test(url) ? url.slice(0, 500) : '',
      confidence: LEVELS.includes(conf) ? conf : 'low',
      notes: inote >= 0 ? String(r[inote] || '').trim().slice(0, 200) : '',
      name: iname >= 0 ? String(r[iname] || '').trim().slice(0, 120) : ''
    });
  });
  return out;
}

// Checked from the start: what has a source and is not "low".
export const preselected = (row) => !!row.source && row.confidence !== 'low';

// The chosen rows as saves: one per certifier, up to 200 barcodes each.
export function batches(rows) {
  const by = new Map();
  for (const r of rows || []) { const l = by.get(r.cert) || []; l.push(r.barcode); by.set(r.cert, l); }
  const out = [];
  for (const [cert, codes] of by) for (let i = 0; i < codes.length; i += 200) out.push({ cert, barcodes: codes.slice(i, i + 200) });
  return out;
}
