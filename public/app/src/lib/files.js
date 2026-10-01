// Turns a picked file into something the importer can read.

export function fileKind(file) {
  const name = String(file.name || '').toLowerCase();
  const type = String(file.type || '').toLowerCase();
  if (name.endsWith('.xlsx') || type.includes('openxmlformats-officedocument.spreadsheetml')) return 'xlsx';
  if (name.endsWith('.xls') || type === 'application/vnd.ms-excel') return 'xls';
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (/\.(csv|tsv)$/.test(name) || type === 'text/csv') return 'csv';
  if (/\.(png|jpe?g|webp)$/.test(name) || /^image\/(png|jpe?g|webp)$/.test(type)) return 'image';
  if (name.endsWith('.txt') || type.startsWith('text/')) return 'text';
  return null;
}

// Israeli banks still export CSV in windows-1255.
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_err) {
    return new TextDecoder('windows-1255').decode(bytes);
  }
}

// Old binary Excel (BIFF) starts with the OLE signature D0 CF 11 E0.
export function isBinaryXls(bytes) {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

// Many "Excel" exports are really an HTML table saved as .xls.
export function htmlTables(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return [...doc.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((td) => td.textContent));
}

export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
