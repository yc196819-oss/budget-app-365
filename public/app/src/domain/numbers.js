// The advisor's numbers must be the screen's numbers. Pure.

// Every amount in a text: "46,771", "₪3,200", "12500" (whole numbers of 3+ digits).
const NUM = /(\d{1,3}(?:,\d{3})+|\d{3,})(?![\d.,]*\d)/g;

// All the amounts the advisor was given (the numbers on the screen), rounded.
export function truthsOf(obj, out = new Set(), depth = 0) {
  if (obj == null || depth > 8) return out;
  if (typeof obj === 'number' && Number.isFinite(obj)) { const v = Math.abs(Math.round(obj)); if (v >= 100) out.add(v); return out; }
  if (Array.isArray(obj)) { for (const x of obj) truthsOf(x, out, depth + 1); return out; }
  if (typeof obj === 'object') { for (const k of Object.keys(obj)) truthsOf(obj[k], out, depth + 1); }
  return out;
}

// An amount that is almost one of the given numbers (within half a percent)
// but not exactly, becomes the exact one, written the same way. Years, small
// numbers, and amounts with no near match are left as they are.
export function alignNumbers(text, truths, tol = 0.005) {
  const list = [...(truths || [])].filter((t) => t >= 1000);
  if (!list.length) return String(text || '');
  const exact = new Set(list);
  return String(text || '').replace(NUM, (raw) => {
    const n = Number(raw.replace(/,/g, ''));
    if (!(n >= 1000) || exact.has(n) || (n >= 1900 && n <= 2100 && !raw.includes(','))) return raw;
    let best = null;
    for (const t of list) { const d = Math.abs(t - n) / t; if (d <= tol && (!best || d < best.d)) best = { t, d }; }
    if (!best) return raw;
    return raw.includes(',') ? best.t.toLocaleString('en-US') : String(best.t);
  });
}

// "The numbers are as of 3.11, 14:20", for an answer that is not fresh: the
// screen may have moved on since (a new line, an updated balance).
export function asOfLabel(iso, now = new Date(), freshMs = 30 * 60 * 1000) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || now - d < freshMs) return '';
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return 'המספרים נכונים ל-' + d.getDate() + '.' + (d.getMonth() + 1) + ', ' + hh + ':' + mm;
}
