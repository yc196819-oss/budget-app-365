// Text out of a PDF statement, made readable for the AI. Pure.
//
// Some banks' PDFs keep Hebrew in visual order: pdf.js then gives a piece of
// text backwards ("הנח ןוצפלוו" for "וולפצון חנה"), sometimes one field in an
// otherwise right line. Final letters tell: in real Hebrew they end a word
// (ם ן ץ ף ך), backwards they start one. Each piece pdf.js gives (or line)
// that reads backwards is turned around; numbers and Latin keep their order.

const FINAL = 'ךםןףץ';
const HEB = /[א-ת]/;
const word = /[א-ת]{2,}/g;

export function looksReversed(line) {
  let back = 0, forward = 0;
  for (const w of String(line).match(word) || []) {
    if (FINAL.includes(w[0])) back++;
    if (FINAL.includes(w[w.length - 1])) forward++;
  }
  return back > forward;
}

// Reverses the whole line, then puts each run of digits/Latin back in order.
export function turnLine(line) {
  const rev = [...line].reverse().join('');
  return rev.replace(/[0-9A-Za-z][0-9A-Za-z.,:/\-@_]*[0-9A-Za-z]|[0-9A-Za-z]/g, (run) => [...run].reverse().join(''));
}

export function fixReversedHebrew(text) {
  return String(text).split('\n').map((l) => (HEB.test(l) && looksReversed(l) ? turnLine(l) : l)).join('\n');
}

// A long statement goes to the AI in parts, cut between lines, so no part is
// longer than `max` characters and none is lost.
export function splitText(text, max = 10000, maxParts = 10) {
  const parts = [];
  let cur = '';
  for (const line of String(text).split('\n')) {
    const l = line.length > max ? line.slice(0, max) : line;
    if (cur && cur.length + l.length + 1 > max) { parts.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + l;
  }
  if (cur.trim()) parts.push(cur);
  return parts.filter((p) => p.trim()).slice(0, maxParts);
}

// Runs fn over items, `n` at a time, keeping their order.
export async function inParts(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
