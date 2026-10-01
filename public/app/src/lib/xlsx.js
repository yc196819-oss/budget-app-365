// Reads the cell values of an .xlsx file: [{ name, rows: [[cell, ...], ...] }].
// An .xlsx file is a zip of XML files. The browser inflates it
// (DecompressionStream), so no spreadsheet library is needed. Only values are
// read: strings stay strings, numbers become numbers (dates arrive as Excel
// day numbers, see normalizeDate). Formulas give their cached value.

const MAX_SHEETS = 6;
const MAX_ROWS = 2000;

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// name -> { method, offset, size } from the zip's central directory.
export function zipEntries(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip directory');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buf, entry) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
  const data = buf.subarray(start, start + entry.size);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflate(data);
  throw new Error('unsupported zip compression');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

// All <t> pieces inside an element (rich text has several).
function textOf(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
}

export function parseSharedStrings(xml) {
  return [...String(xml || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

function colIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/);
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseSheet(xml, strings) {
  const rows = [];
  for (const rm of String(xml).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (rows.length >= MAX_ROWS) break;
    const row = [];
    let next = 0;
    for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const idx = ref ? colIndex(ref) : next;
      next = idx + 1;
      const type = (attrs.match(/\bt="(\w+)"/) || [])[1] || 'n';
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let value = '';
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str' || type === 'e') value = v != null ? unescapeXml(v) : '';
      else if (type === 'b') value = v === '1';
      else if (v != null && v !== '') value = Number(v);
      while (row.length < idx) row.push('');
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows;
}

export async function readXlsx(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const entries = zipEntries(buf);
  const text = async (name) => {
    const e = entries.get(name);
    return e ? new TextDecoder().decode(await readEntry(buf, e)) : '';
  };
  const strings = parseSharedStrings(await text('xl/sharedStrings.xml'));
  // Sheet order and names come from the workbook; file names are the fallback.
  const workbook = await text('xl/workbook.xml');
  const rels = await text('xl/_rels/workbook.xml.rels');
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    (m[0].match(/\bId="([^"]+)"/) || [])[1],
    (m[0].match(/\bTarget="([^"]+)"/) || [])[1]
  ]));
  let sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = unescapeXml((m[0].match(/\bname="([^"]*)"/) || [])[1] || '');
    const target = targets.get((m[0].match(/\br:id="([^"]+)"/) || [])[1]) || '';
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    return { name, path };
  }).filter((s) => entries.has(s.path));
  if (!sheets.length) {
    sheets = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort().map((path, i) => ({ name: 'גיליון ' + (i + 1), path }));
  }
  const out = [];
  for (const s of sheets.slice(0, MAX_SHEETS)) out.push({ name: s.name, rows: parseSheet(await text(s.path), strings) });
  return out;
}
