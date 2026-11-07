// Mistakes the advisor can find in what was uploaded, and how to fix each one
// with a single tap. Runs on the device each time the app opens; pure.
//
//   chargedate: a statement whose purchases all got the day the card was
//     charged instead of the day of each purchase (a PDF read badly). Lines
//     already here with their real date are dropped; the others move to an
//     estimated date in the month they were really bought.
//   junk: a file that was not a statement at all (dozens of ₪1 "purchases").

// Strict on purpose: only a mistake that is certain is shown. In the real
// cases 94%-96% of a file's lines (16 to 81 of them) shared the charge day.
const MIN_LINES = 10;
const SHARE = 0.85;
const MAX_DAYS = 3;
const JUNK_SHARE = 0.9;
// The source of a line the advisor already moved: never looked at again.
export const REPAIRED = 'repaired';
const DAY = 86400000;

// The name without digits, signs or spaces: "שופרסל דיל 123" -> "שופרסלדיל".
export const normName = (d) => String(d || '').toLowerCase().replace(/[^\p{L}]/gu, '');
const iso = (d) => d.toISOString().slice(0, 10);
const cents = (a) => Math.round(Math.abs(Number(a) || 0) * 100);
const sumOf = (list) => list.reduce((s, t) => s + (Number(t.amount) || 0), 0);

// Where the purchases most likely were: a charge early in the month pays for
// the month before (its last day); a later charge, for the same month (the 15th).
export function estimatedDate(chargeDay) {
  const d = new Date(chargeDay + 'T12:00:00Z');
  if (d.getUTCDate() <= 15) return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12)));
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15, 12)));
}

function chargeDateIssues(txs) {
  const groups = new Map();
  for (const t of txs) {
    if (!t.import_id || t.type === 'income' || t.source === REPAIRED) continue;
    const k = t.import_id + '|' + (t.card_id || 'bank');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const [key, lines] of groups) {
    if (lines.length < MIN_LINES) continue;
    const byDay = new Map();
    for (const t of lines) byDay.set(t.tx_date, (byDay.get(t.tx_date) || 0) + 1);
    const [day, count] = [...byDay].sort((a, b) => b[1] - a[1])[0];
    // A real statement spreads over the month: a big shopping day is a few
    // lines, never 85% of the file in at most 3 days.
    if (count < MIN_LINES || count / lines.length < SHARE || byDay.size > MAX_DAYS) continue;
    const onDay = lines.filter((t) => t.tx_date === day);
    const importId = lines[0].import_id;
    const card = lines[0].card_id || null;
    // The same purchase, from another upload, with its own date.
    const sig = (t) => (t.card_id || 'bank') + '|' + normName(t.description) + '|' + cents(t.amount);
    const elsewhere = new Map();
    for (const t of txs) {
      if (t.import_id === importId || t.type === 'income') continue;
      const s = sig(t);
      if (!elsewhere.has(s)) elsewhere.set(s, []);
      elsewhere.get(s).push(t);
    }
    const inFile = new Map();
    for (const t of onDay) inFile.set(sig(t), (inFile.get(sig(t)) || 0) + 1);
    const charged = new Date(day + 'T12:00:00Z').getTime();
    const drop = [];
    const move = [];
    for (const t of onDay) {
      const twins = elsewhere.get(sig(t)) || [];
      // Only a purchase seen exactly once elsewhere, within the 75 days before
      // the charge, and once in this file: a coffee bought every week at the
      // same price could be another purchase, so it is moved, never dropped.
      const near = twins.filter((o) => { const gap = charged - new Date(o.tx_date + 'T12:00:00Z').getTime(); return gap >= 0 && gap <= 75 * DAY; });
      if (twins.length === 1 && near.length === 1 && inFile.get(sig(t)) === 1) drop.push(t);
      else move.push(t);
    }
    out.push({ kind: 'chargedate', key: 'chargedate:' + key, importId, card, day, moveTo: estimatedDate(day),
      count: onDay.length, total: sumOf(onDay), drop: drop.map((t) => t.id), dropTotal: sumOf(drop), move: move.map((t) => t.id), moveTotal: sumOf(move) });
  }
  return out;
}

function junkIssues(txs) {
  const groups = new Map();
  for (const t of txs) {
    if (!t.import_id) continue;
    if (!groups.has(t.import_id)) groups.set(t.import_id, []);
    groups.get(t.import_id).push(t);
  }
  const out = [];
  for (const [importId, lines] of groups) {
    if (lines.length < MIN_LINES) continue;
    const tiny = lines.filter((t) => Math.abs(Number(t.amount) || 0) <= 1);
    if (tiny.length / lines.length < JUNK_SHARE) continue;
    out.push({ kind: 'junk', key: 'junk:' + importId, importId, count: lines.length, total: sumOf(lines), ids: lines.map((t) => t.id) });
  }
  return out;
}

// Every mistake found, minus the ones the household chose to keep. A file
// that is junk is not also reported for its dates.
export function findRepairs(txs, skipped = new Set()) {
  const junk = junkIssues(txs);
  const junkFiles = new Set(junk.map((j) => j.importId));
  return [...junk, ...chargeDateIssues(txs).filter((c) => !junkFiles.has(c.importId))].filter((r) => !skipped.has(r.key));
}
