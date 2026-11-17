// The AI's answer for a part of a statement → the list of transactions, or
// null when it truly cannot be read. Forgiving of what models do around the
// JSON: a code fence anywhere, words before or after, a wrapper object, a
// thousands separator in a number ("1,234.50"), a trailing comma. A part
// with no transactions (a summary page) answered in words or as an object
// with no list is an empty part, not a failure.

const NO_ROWS = /אין\s+(בקטע|בחלק|כאן|עסקאות|תנועות)|לא\s+(נמצאו|מצאתי|קיימות)\s+(עסקאות|תנועות)|no\s+transactions/i;

function tryParse(s) {
  try { return JSON.parse(s); } catch (_e) { return undefined; }
}

// Small, safe repairs: only inside numbers and before a closing bracket.
function repaired(s) {
  return s
    .replace(/(:\s*-?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?=\s*[,}\]])/g, (_m, p, n) => p + n.replace(/,/g, ''))
    .replace(/,\s*([}\]])/g, '$1');
}

function asList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const arr = Object.values(v).find(Array.isArray);
    return arr || [];
  }
  return null;
}

function parseImport(raw) {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  if (!text) return null;
  const candidates = [text];
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
  const o = text.indexOf('{'), p = text.lastIndexOf('}');
  if (o >= 0 && p > o && (a < 0 || o < a)) candidates.push(text.slice(o, p + 1));
  for (const c of candidates) {
    for (const s of [c, repaired(c)]) {
      const v = tryParse(s);
      if (v !== undefined) { const list = asList(v); if (list) return list; }
    }
  }
  // Words only, saying the part has no transactions.
  if (a < 0 && NO_ROWS.test(text)) return [];
  return null;
}

// What can be said about an unreadable answer without its content (it is a
// person's statement): for the owner's error log.
function shapeOf(raw) {
  const t = String(raw || '');
  return 'len=' + t.length + ' bracket=' + (t.includes('[') ? 1 : 0) + ' brace=' + (t.includes('{') ? 1 : 0) + ' fence=' + (t.includes('```') ? 1 : 0);
}

module.exports = { parseImport, shapeOf, NO_ROWS };
