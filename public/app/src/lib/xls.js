// Reads the cell values of an old binary Excel file (.xls, Excel 97-2003):
// [{ name, rows: [[cell, ...], ...] }], the same shape readXlsx gives.
// Such a file is an OLE "compound file" (a small file system of sectors)
// holding one stream, "Workbook", made of BIFF records. Only values are read:
// strings stay strings, numbers become numbers (dates arrive as Excel day
// numbers, see normalizeDate), formulas give their cached value.

const MAX_SHEETS = 6;
const MAX_ROWS = 2000;
const END = 0xfffffffe;
const FREE = 0xffffffff;

export class XlsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---- the compound file -----------------------------------------------------

function compoundStream(buf, wanted) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 512 || view.getUint32(0, true) !== 0xe011cfd0) throw new XlsError('format', 'not a compound file');
  const secSize = 1 << view.getUint16(30, true);
  const miniSize = 1 << view.getUint16(32, true);
  if (secSize < 128 || secSize > 65536 || miniSize > secSize) throw new XlsError('format', 'bad sector size');
  const nFat = view.getUint32(44, true);
  const dirStart = view.getUint32(48, true);
  const cutoff = view.getUint32(56, true);
  const miniFatStart = view.getUint32(60, true);
  let difatSec = view.getUint32(68, true);
  const sectors = Math.floor((buf.length - secSize) / secSize);
  const offset = (s) => (s + 1) * secSize;
  const u32 = (s, i) => (s < sectors ? view.getUint32(offset(s) + i * 4, true) : FREE);

  // Where the FAT's own sectors are: 109 in the header, the rest in a chain.
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(view.getUint32(76 + i * 4, true));
  const perSec = secSize / 4;
  for (let guard = 0; fatSecs.length < nFat && difatSec < sectors && guard < sectors; guard++) {
    for (let i = 0; i < perSec - 1 && fatSecs.length < nFat; i++) fatSecs.push(u32(difatSec, i));
    difatSec = u32(difatSec, perSec - 1);
  }
  const fat = new Uint32Array(fatSecs.length * perSec);
  fatSecs.forEach((s, k) => { for (let i = 0; i < perSec; i++) fat[k * perSec + i] = u32(s, i); });

  const chain = (start, next, limit) => {
    const out = [];
    for (let s = start; s !== END && s !== FREE && s < limit; s = next[s]) {
      out.push(s);
      if (out.length > limit) throw new XlsError('format', 'sector loop');
    }
    return out;
  };
  const read = (start, size) => {
    const out = new Uint8Array(size);
    let at = 0;
    for (const s of chain(start, fat, Math.min(fat.length, sectors))) {
      if (at >= size) break;
      const part = buf.subarray(offset(s), offset(s) + Math.min(secSize, size - at));
      out.set(part, at);
      at += part.length;
    }
    return out.subarray(0, at);
  };

  // The directory: 128-byte entries; the root's stream holds the mini sectors.
  const dirSecs = chain(dirStart, fat, Math.min(fat.length, sectors));
  const entries = [];
  for (const s of dirSecs) {
    for (let i = 0; i < secSize / 128; i++) {
      const p = offset(s) + i * 128;
      const nameLen = view.getUint16(p + 64, true);
      let name = '';
      for (let c = 0; c + 2 < nameLen && c < 64; c += 2) name += String.fromCharCode(view.getUint16(p + c, true));
      entries.push({ name, type: buf[p + 66], start: view.getUint32(p + 116, true), size: view.getUint32(p + 120, true) });
    }
  }
  const root = entries.find((e) => e.type === 5);
  const entry = entries.find((e) => e.type === 2 && wanted.includes(e.name));
  if (!entry) throw new XlsError('format', 'no workbook stream');
  if (entry.size >= cutoff || !root) return read(entry.start, entry.size);

  // A small stream lives in mini sectors inside the root's stream.
  const miniStream = read(root.start, root.size);
  const miniFatBytes = read(miniFatStart, view.getUint32(64, true) * secSize);
  const miniFat = new Uint32Array(miniFatBytes.length / 4);
  const mv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = mv.getUint32(i * 4, true);
  const out = new Uint8Array(entry.size);
  let at = 0;
  for (const s of chain(entry.start, miniFat, miniFat.length)) {
    if (at >= entry.size) break;
    const part = miniStream.subarray(s * miniSize, s * miniSize + Math.min(miniSize, entry.size - at));
    out.set(part, at);
    at += part.length;
  }
  return out.subarray(0, at);
}

// ---- BIFF records ----------------------------------------------------------

function rk(v) {
  let n;
  if (v & 2) n = v >> 2;
  else {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(4, v & 0xfffffffc, true);
    n = dv.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

function utf16(bytes, p, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p + i * 2] | (bytes[p + i * 2 + 1] << 8));
  return s;
}

function latin(bytes, p, n, decoder) {
  return decoder ? decoder.decode(bytes.subarray(p, p + n)) : String.fromCharCode(...bytes.subarray(p, p + n));
}

// The shared strings table. A string may be cut between the SST record and
// the CONTINUE records after it; each piece of characters that continues
// starts with a fresh "16-bit or 8-bit" flag byte.
function readSst(pieces) {
  const out = [];
  let k = 0;
  let p = 8;
  let data = pieces[0];
  const next = () => { k++; data = pieces[k]; p = 0; return !!data; };
  const total = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true);
  const byte = () => { if (p >= data.length && !next()) throw new Error('eof'); return data[p++]; };
  const u16 = () => byte() | (byte() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const skip = (n) => {
    while (n > 0) {
      if (p >= data.length && !next()) return;
      const t = Math.min(n, data.length - p);
      p += t; n -= t;
    }
  };
  try {
    while (out.length < total && data) {
      if (p >= data.length && !next()) break;
      const cch = u16();
      let flags = byte();
      const runs = flags & 8 ? u16() : 0;
      const ext = flags & 4 ? u32() : 0;
      let s = '';
      let left = cch;
      while (left > 0) {
        if (p >= data.length) { if (!next()) break; flags = data[p++]; }
        const wide = flags & 1;
        const fit = Math.min(left, Math.floor((data.length - p) / (wide ? 2 : 1)));
        s += wide ? utf16(data, p, fit) : latin(data, p, fit, null);
        p += fit * (wide ? 2 : 1);
        left -= fit;
        if (fit === 0 && p < data.length) break;
      }
      skip(runs * 4 + ext);
      out.push(s);
    }
  } catch (_e) { /* a cut table keeps the strings read so far */ }
  return out;
}

export function parseBiff(stream) {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const sheetsAt = new Map();
  const sheets = [];
  let strings = [];
  let sstPieces = null;
  let decoder = null;
  let biff8 = true;
  let depth = 0;
  let sheet = null;
  let pendingString = null;
  const put = (r, c, v) => {
    if (!sheet || r >= MAX_ROWS) return;
    const row = sheet.rows[r] || (sheet.rows[r] = []);
    row[c] = v;
  };
  const xlString = (p, lenBytes) => {
    const cch = lenBytes === 1 ? stream[p] : view.getUint16(p, true);
    p += lenBytes;
    if (!biff8) return latin(stream, p, cch, decoder);
    const wide = stream[p] & 1;
    const rich = stream[p] & 8;
    const ext = stream[p] & 4;
    p += 1 + (rich ? 2 : 0) + (ext ? 4 : 0);
    return wide ? utf16(stream, p, Math.min(cch, (stream.length - p) >> 1)) : latin(stream, p, cch, null);
  };

  for (let pos = 0; pos + 4 <= stream.length;) {
    const type = view.getUint16(pos, true);
    const len = view.getUint16(pos + 2, true);
    const d = pos + 4;
    const end = d + len;
    if (end > stream.length) break;
    if (sstPieces && type !== 0x003c) { strings = readSst(sstPieces); sstPieces = null; }
    switch (type) {
      case 0x0809: // BOF
        if (depth === 0) {
          biff8 = view.getUint16(d, true) === 0x0600;
          const name = sheetsAt.get(pos);
          if (name != null && sheets.length < MAX_SHEETS) { sheet = { name, rows: [] }; sheets.push(sheet); }
        }
        depth++;
        break;
      case 0x000a: // EOF
        depth = Math.max(0, depth - 1);
        if (depth === 0) sheet = null;
        break;
      case 0x002f: // FILEPASS
        if (depth === 1 && !sheet) throw new XlsError('password', 'the file is protected by a password');
        break;
      case 0x0042: { // CODEPAGE
        const cp = view.getUint16(d, true);
        if (cp !== 1200) { try { decoder = new TextDecoder('windows-' + cp); } catch (_e) { decoder = null; } }
        break;
      }
      case 0x0085: { // BOUNDSHEET
        if (stream[d + 5] === 0) sheetsAt.set(view.getUint32(d, true), xlString(d + 6, 1));
        break;
      }
      case 0x00fc: sstPieces = [stream.subarray(d, end)]; break; // SST
      case 0x003c: if (sstPieces) sstPieces.push(stream.subarray(d, end)); break; // CONTINUE
      case 0x00fd: put(view.getUint16(d, true), view.getUint16(d + 2, true), strings[view.getUint32(d + 6, true)] ?? ''); break; // LABELSST
      case 0x0204: case 0x00d6: put(view.getUint16(d, true), view.getUint16(d + 2, true), xlString(d + 6, 2)); break; // LABEL, RSTRING
      case 0x0203: put(view.getUint16(d, true), view.getUint16(d + 2, true), view.getFloat64(d + 6, true)); break; // NUMBER
      case 0x027e: put(view.getUint16(d, true), view.getUint16(d + 2, true), rk(view.getUint32(d + 6, true))); break; // RK
      case 0x00bd: { // MULRK
        const r = view.getUint16(d, true);
        let c = view.getUint16(d + 2, true);
        for (let q = d + 4; q + 6 <= end - 2; q += 6) put(r, c++, rk(view.getUint32(q + 2, true)));
        break;
      }
      case 0x0205: { // BOOLERR
        if (stream[d + 7] === 0) put(view.getUint16(d, true), view.getUint16(d + 2, true), stream[d + 6] === 1);
        break;
      }
      case 0x0006: { // FORMULA: its cached result
        const r = view.getUint16(d, true);
        const c = view.getUint16(d + 2, true);
        if (view.getUint16(d + 12, true) !== 0xffff) put(r, c, view.getFloat64(d + 6, true));
        else if (stream[d + 6] === 0) pendingString = [r, c]; // the text comes in the STRING record
        else if (stream[d + 6] === 1) put(r, c, stream[d + 8] === 1);
        break;
      }
      case 0x0207: // STRING
        if (pendingString) { put(pendingString[0], pendingString[1], xlString(d, 2)); pendingString = null; }
        break;
      default:
    }
    pos = end;
  }
  if (sstPieces) strings = readSst(sstPieces);
  return sheets.map((s) => {
    const rows = [];
    for (let r = 0; r < s.rows.length; r++) {
      const row = s.rows[r] || [];
      const filled = [];
      for (let c = 0; c < row.length; c++) filled.push(row[c] === undefined ? '' : row[c]);
      rows.push(filled);
    }
    return { name: s.name, rows };
  });
}

export function readXls(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  return parseBiff(compoundStream(buf, ['Workbook', 'Book']));
}
