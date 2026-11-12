// "Complete the picture": the household's banks and cards, which statements
// were uploaded for each month, what is still missing, and when to remind
// (a card on its billing day, a bank account after the salary comes in).
// Pure.

// The banks and card companies, with their logo and official site.
export const PROVIDERS = [
  { key: 'leumi', kind: 'bank', name: 'לאומי', logo: 'leumi.svg', url: 'https://www.leumi.co.il/', re: /לאומי|leumi/i },
  { key: 'hapoalim', kind: 'bank', name: 'הפועלים', logo: 'hapoalim.svg', url: 'https://www.bankhapoalim.co.il/', re: /פועלים|hapoalim/i },
  { key: 'discount', kind: 'bank', name: 'דיסקונט', logo: 'discount.svg', url: 'https://www.discountbank.co.il/', re: /דיסקונט|discount/i },
  { key: 'mizrahi', kind: 'bank', name: 'מזרחי טפחות', logo: 'mizrahi.svg', url: 'https://www.mizrahi-tefahot.co.il/', re: /מזרחי|טפחות|mizrahi/i },
  { key: 'fibi', kind: 'bank', name: 'הבינלאומי', logo: 'fibi.png', url: 'https://www.fibi.co.il/', re: /בינלאומי|fibi/i },
  { key: 'pagi', kind: 'bank', name: 'פאג״י', logo: 'pagi.png', url: 'https://www.pagi.co.il/', re: /פאג["״']?י|pagi/i },
  { key: 'jerusalem', kind: 'bank', name: 'בנק ירושלים', logo: 'jerusalem.svg', url: 'https://www.bankjerusalem.co.il/', re: /ירושלים|jerusalem/i },
  { key: 'yahav', kind: 'bank', name: 'יהב', logo: 'yahav.png', url: 'https://www.bank-yahav.co.il/', re: /יהב|yahav/i },
  { key: 'otsar', kind: 'bank', name: 'אוצר החייל', logo: 'otsar.png', url: 'https://www.bankotsar.co.il/', re: /אוצר החייל|otsar/i },
  { key: 'massad', kind: 'bank', name: 'מסד', logo: 'massad.png', url: 'https://www.bankmassad.co.il/', re: /מסד|massad/i },
  { key: 'mercantile', kind: 'bank', name: 'מרכנתיל', logo: 'mercantile.png', url: 'https://www.mercantile.co.il/', re: /מרכנתיל|mercantile/i },
  { key: 'onezero', kind: 'bank', name: 'וואן זירו', logo: 'onezero.svg', url: 'https://www.onezerobank.com/', re: /וואן זירו|one ?zero/i },
  { key: 'max', kind: 'card', name: 'מקס', logo: 'max.svg', url: 'https://www.max.co.il/', re: /מקס|max|לאומי ?קארד|dream ?card|דרים ?קארד/i },
  { key: 'cal', kind: 'card', name: 'כאל', logo: 'cal.svg', url: 'https://www.cal-online.co.il/', re: /כאל|cal\b|visa ?cal/i },
  { key: 'isracard', kind: 'card', name: 'ישראכרט', logo: 'isracard.svg', url: 'https://www.isracard.co.il/', re: /ישראכרט|isracard|רמי ?לוי/i },
  { key: 'amex', kind: 'card', name: 'אמריקן אקספרס', logo: 'amex.png', url: 'https://www.americanexpress.co.il/', re: /אמריקן|אמקס|amex|american/i },
  { key: 'diners', kind: 'card', name: 'דיינרס', logo: 'diners.png', url: 'https://www.diners.co.il/', re: /דיינרס|diners/i, dark: true }
];
export const providerOf = (key) => PROVIDERS.find((p) => p.key === key) || null;
// Which provider a free-text name points at ("כרטיס מקס של דנה" -> max).
export function guessProvider(text, kind) {
  const t = String(text || '');
  const p = PROVIDERS.find((x) => (!kind || x.kind === kind) && x.re.test(t));
  return p ? p.key : null;
}
// Where to find the statement on the provider's site, in a sentence.
// A card the bank itself issued: its statement is on the bank's site.
export function howTo(kind, provider = null) {
  const p = providerOf(provider);
  if (kind === 'card' && p && p.kind === 'bank') return 'באתר הבנק: כרטיסי אשראי ← פירוט חיובים ← בוחרים את החודש ← ייצוא לאקסל.';
  return kind === 'card'
    ? 'באתר: פירוט עסקאות ← בוחרים את החודש ← ייצוא לאקסל (או שמירה כ-PDF).'
    : 'באתר: עובר ושב ← תנועות בחשבון ← בוחרים את החודש ← ייצוא לאקסל.';
}

// Which company a file is from, by the name in its opening lines (null when
// none is named). The first name in the text wins: a bank statement names
// its bank before any card company that charged it.
export function issuerOf(text) {
  const t = String(text || '').slice(0, 1500);
  let best = null;
  for (const p of PROVIDERS) {
    const m = p.re.exec(t);
    if (m && (!best || m.index < best.at)) best = { key: p.key, at: m.index };
  }
  return best ? best.key : null;
}

// A company's card statement covers all its cards: one file a month for
// the company, not one for each card. A card the bank issued counts apart
// from the bank account. Returns the household's sources with the cards of
// one company as one (ids: every card's id, count: how many).
export function companiesOf(sources) {
  const out = [];
  const seen = new Map();
  for (const s of sources) {
    if (s.kind !== 'card' || !s.provider) { out.push({ ...s, ids: [s.id], count: 1 }); continue; }
    const g = seen.get(s.provider);
    if (g) { g.ids.push(s.id); g.count++; if (!g.billingDay && s.billingDay) g.billingDay = s.billingDay; continue; }
    const one = { ...s, ids: [s.id], count: 1 };
    seen.set(s.provider, one);
    out.push(one);
  }
  return out;
}

// The file may belong to another account or card than the one chosen: the
// card digits in its lines are another card's, or it names another company.
// Returns { to, provider, text } (to: the household's source, or null when
// the company is not in the list yet), or null when nothing says so.
export function otherSource({ source, items = [], issuer = null, sources = [] }) {
  if (!source) return null;
  const fours = new Set(items.map((t) => t.card4).filter(Boolean));
  if (source.kind === 'card' && fours.size && !(source.last4 && fours.has(String(source.last4)))) {
    const to = sources.find((x) => x.kind === 'card' && x.id !== source.id && x.last4 && fours.has(String(x.last4)));
    if (to && to.provider !== source.provider) return { to, provider: to.provider, text: 'זה פירוט של ' + nameOf(to) + (to.last4 ? ' (כרטיס ' + to.last4 + ')' : '') + ', לא של ' + nameOf(source) };
  }
  const p = providerOf(issuer);
  const mine = providerOf(source.provider);
  // A card the bank issued may carry a card company's name: not a mistake.
  if (!p || !mine || p.key === mine.key || mine.kind !== source.kind) return null;
  if (p.kind !== source.kind) return null;
  const to = sources.find((x) => x.kind === source.kind && x.provider === p.key) || null;
  return { to, provider: p.key, text: 'זה נראה כמו פירוט של ' + p.name + ', לא של ' + mine.name };
}
// A company with several cards: does the file carry all of them? Returns
// { found, total } when some card's digits are missing, else null (the
// digits the lines carry are counted; a file without digits says nothing).
export function missingCards({ source, items = [], sources = [] }) {
  if (!source || source.kind !== 'card' || !source.provider) return null;
  const total = sources.filter((x) => x.kind === 'card' && x.provider === source.provider).length;
  const found = new Set(items.map((t) => t.card4).filter(Boolean)).size;
  return total > 1 && found > 0 && found < total ? { found, total } : null;
}

// A source saved before the companies were chosen (no company yet): the
// company its file names, when it fits (a bank account: a bank; a card: a
// card company, or a bank for a card the bank issued). Null otherwise.
export function learnProvider({ source, issuer }) {
  const p = providerOf(issuer);
  if (!source || !p || source.saved) return null;
  if (source.kind === 'bank' && p.kind !== 'bank') return null;
  return p.key;
}

// The name people know a source by: the company, or "אשראי לאומי" for a
// card the bank issued.
export function nameOf(s) {
  const p = providerOf(s.provider);
  if (!p) return s.name;
  return s.kind === 'card' && p.kind === 'bank' ? 'אשראי ' + p.name : p.name;
}

// The same, in three short steps (for the sheet that opens on a company).
export function howSteps(kind, provider = null) {
  const p = providerOf(provider);
  const site = p ? 'נכנסים לאתר של ' + p.name : 'נכנסים לאתר הרשמי';
  if (kind === 'card' && p && p.kind === 'bank') return [site, 'כרטיסי אשראי ← פירוט חיובים', 'בוחרים את חודש החיוב ← ייצוא לאקסל'];
  if (kind === 'card') return [site, 'פירוט עסקאות ← בוחרים את חודש החיוב', 'ייצוא לאקסל (או שמירה כ-PDF)'];
  return [site, 'עובר ושב ← תנועות בחשבון', 'בוחרים את החודש ← ייצוא לאקסל'];
}

const pad = (n) => String(n).padStart(2, '0');
const ym = (y, m) => y + '-' + pad(m + 1); // m is 0-based
const ymOf = (d) => ym(d.getFullYear(), d.getMonth());
const parse = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
export const monthName = (key) => MONTH_NAMES[Number(key.slice(5)) - 1];
export const monthShort = (key) => SHORT[Number(key.slice(5)) - 1];

// The household's sources: every bank account and every active card.
export function sourcesOf({ accounts = [], cards = [] }) {
  return [
    ...accounts.map((a) => ({ kind: 'bank', id: a.id, name: a.name || a.bank_name || 'חשבון בנק', provider: a.provider || guessProvider(a.bank_name || a.name, 'bank'), saved: !!a.provider, salaryDay: Number(a.salary_day) || null })),
    ...cards.filter((c) => c.is_active !== false).map((c) => ({ kind: 'card', id: c.id, name: c.name || 'כרטיס', provider: c.provider || guessProvider(c.name, 'card'), saved: !!c.provider, billingDay: Number(c.billing_day) || null, last4: c.last4 || null }))
  ];
}

// The month a card statement belongs to: the month it was charged. Its last
// purchase falls before the billing day of that month (or of the month
// before, when it was after the billing day).
export function billingMonth(lastPurchase, billingDay = 10) {
  const d = parse(lastPurchase);
  const day = billingDay || 10;
  // A purchase on the charge day itself still ends that month's statement
  // (a statement downloaded on the 12th that stops on the 10th is the 10th's).
  return d.getDate() <= day ? ymOf(d) : ym(d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear(), (d.getMonth() + 1) % 12);
}

// The files that belong to a source: chosen for it when uploaded, or (older
// files) recognised by their lines. A bank file is anything not from a card
// when the household has a single bank account.
export function filesOf(source, { imports = [], txs = [], banks = 1 } = {}) {
  const own = imports.filter((f) => f.source_id === source.id && f.date_from && f.date_to);
  const byImport = new Map();
  for (const t of txs) {
    if (!t.import_id) continue;
    const g = byImport.get(t.import_id) || { from: t.tx_date, to: t.tx_date, card: new Set(), credit: 0, account: new Set(), n: 0 };
    if (t.tx_date < g.from) g.from = t.tx_date;
    if (t.tx_date > g.to) g.to = t.tx_date;
    if (t.card_id) g.card.add(t.card_id);
    if (t.account_id) g.account.add(t.account_id);
    if (t.payment_method === 'credit') g.credit++;
    g.n++;
    byImport.set(t.import_id, g);
  }
  const known = new Set(imports.filter((f) => f.source_id).map((f) => f.id));
  const inferred = [];
  for (const [id, g] of byImport) {
    if (known.has(id)) continue;
    const mine = source.kind === 'card'
      ? g.card.has(source.id)
      : g.account.has(source.id) || (banks === 1 && !g.card.size && g.credit < g.n / 2);
    if (mine) inferred.push({ id, date_from: g.from, date_to: g.to });
  }
  return [...own, ...inferred];
}

// One source in one month: 'ok' (uploaded), 'partial' (only part of the
// month), 'missing', or 'waiting' (not due yet).
export function statusOf(source, files, key, today = new Date()) {
  const [y, m] = key.split('-').map(Number);
  const nowKey = ymOf(today);
  if (source.kind === 'card') {
    const has = files.some((f) => billingMonth(f.date_to, source.billingDay) === key);
    if (has) return 'ok';
    if (key === nowKey && !pastCharge(source, today)) return 'waiting';
    return key > nowKey ? 'waiting' : 'missing';
  }
  if (key >= nowKey) return 'waiting';
  const total = daysIn(y, m - 1);
  const covered = new Set();
  for (const f of files) {
    const a = parse(f.date_from), b = parse(f.date_to);
    for (let d = 1; d <= total; d++) {
      const day = new Date(y, m - 1, d);
      if (day >= a && day <= b) covered.add(d);
    }
  }
  if (covered.size >= total * 0.75) return 'ok';
  return covered.size ? 'partial' : 'missing';
}

// A card's statement is asked for from the day after its charge: by then
// it is surely on the company's site (charged on the 10th: from the 11th).
// A billing day past the month's end counts as its last day.
export function pastCharge(source, today = new Date()) {
  const last = daysIn(today.getFullYear(), today.getMonth());
  return today.getDate() > Math.min(source.billingDay || 10, last);
}

// The month whose statement is due now for a source: a card's this month
// from its billing day on (the month before until then); a bank account's
// the month that just ended.
export function dueMonth(source, today = new Date()) {
  const prev = ym(today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear(), (today.getMonth() + 11) % 12);
  if (source.kind === 'card') return pastCharge(source, today) ? ymOf(today) : prev;
  return prev;
}

// The day the next statement of a source can be uploaded, once everything
// due now is in: a card's the day after its next charge; a bank account's
// the 1st of next month (when this month ends).
export function nextDue(source, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth();
  if (source.kind !== 'card') return new Date(y, m + 1, 1);
  const on = (yy, mm) => new Date(yy, mm, Math.min(source.billingDay || 10, daysIn(yy, mm)) + 1);
  return pastCharge(source, today) ? on(y, m + 1) : on(y, m);
}
// What comes next for each account and card, the nearest first.
export function upcoming(rows, today = new Date()) {
  return rows.map((r) => ({ source: r.source, date: nextDue(r.source, today) })).sort((a, b) => a.date - b.date);
}

// Everything the screen shows: the last 6 months for every source, the ring
// (what is due now, how much of it is uploaded) and the reminders.
export function tracker({ accounts = [], cards = [], imports = [], txs = [] }, today = new Date(), n = 6) {
  const all = sourcesOf({ accounts, cards });
  const banks = all.filter((s) => s.kind === 'bank').length;
  const sources = companiesOf(all);
  const months = Array.from({ length: n }, (_, i) => { const d = new Date(today.getFullYear(), today.getMonth() - (n - 1) + i, 1); return ymOf(d); });
  const rows = sources.map((s) => {
    const files = s.ids.flatMap((id) => filesOf({ ...s, id }, { imports, txs, banks }));
    return { source: s, files, months: months.map((k) => ({ key: k, status: statusOf(s, files, k, today) })), due: dueMonth(s, today) };
  });
  const due = rows.map((r) => ({ ...r, dueStatus: statusOf(r.source, r.files, r.due, today) }));
  const done = due.filter((r) => r.dueStatus === 'ok').length;
  const tasks = due.filter((r) => r.dueStatus !== 'ok').map((r) => reminder(r.source, r.due, r.dueStatus, today));
  // The months with nothing missing in a row, counted back from the last.
  const full = months.filter((k) => k < ymOf(today)).reverse();
  let streak = 0;
  for (const k of full) { if (rows.length && rows.every((r) => ['ok', 'waiting'].includes(statusOf(r.source, r.files, k, today)))) streak++; else break; }
  return { sources, months, rows, ring: { done, total: rows.length, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 }, tasks, streak };
}

// One reminder, in plain words, with the date it is about.
export function reminder(source, key, status, today = new Date()) {
  const p = providerOf(source.provider);
  const who = nameOf(source);
  const [y, m] = key.split('-').map(Number);
  if (source.kind === 'card') {
    const day = source.billingDay || 10;
    return { source, key, status, title: 'להעלות את פירוט ' + who + ' של ' + monthName(key),
      note: 'החיוב ירד ב-' + day + '.' + m + (status === 'partial' ? ' · הקובץ שהועלה לא שלם' : '') + (source.count > 1 ? ' · ' + source.count + ' כרטיסים, פירוט אחד לכולם' : source.last4 ? ' · כרטיס ' + source.last4 : '') };
  }
  const salary = source.salaryDay;
  const after = salary && today.getDate() >= salary;
  return { source, key, status, title: 'להעלות את פירוט העו״ש של ' + monthName(key) + (p ? ' (' + p.name + ')' : ''),
    note: status === 'partial' ? 'הקובץ שהועלה לא מכסה את כל החודש' : after ? 'המשכורת נכנסה ב-' + salary + ' לחודש: זה זמן טוב להעלות' : 'החודש נגמר, הפירוט כבר זמין באתר הבנק' };
}

// A file being uploaded, checked against the source it was chosen for.
export function checkFile({ source, items = [], fromCard = false, sources = [], today = new Date() }) {
  const out = [];
  const kept = items.filter((t) => t.include);
  if (!source) return out;
  const name = nameOf(source);
  // A card's statement: found so by the reader, or its lines carry card digits.
  fromCard = fromCard || items.some((t) => t.card4);
  if (source.kind === 'card' && !fromCard) out.push({ ok: null, text: 'לא בטוחים שזה פירוט של כרטיס. בדקו שבחרתם את הקובץ הנכון.' });
  else if (source.kind === 'bank' && fromCard) out.push({ ok: false, text: 'הקובץ נראה כמו פירוט של כרטיס אשראי, לא של חשבון בנק.' });
  else out.push({ ok: true, text: 'זה פירוט של ' + name + (source.last4 ? ' (כרטיס ' + source.last4 + ')' : '') });
  if (source.kind === 'card' && source.last4) {
    const fours = new Set(items.map((t) => t.card4).filter(Boolean));
    // Any card of the same company is fine: one statement covers them all.
    const mine = new Set([source, ...sources.filter((x) => x.kind === 'card' && source.provider && x.provider === source.provider)].map((x) => x.last4).filter(Boolean).map(String));
    if (fours.size && ![...fours].some((f) => mine.has(f))) out.push({ ok: false, text: 'בקובץ מופיע כרטיס ' + [...fours].join(', ') + ', לא ' + source.last4 + '.' });
  }
  const dates = kept.map((t) => t.date).filter(Boolean).sort();
  if (dates.length) {
    const key = source.kind === 'card' ? billingMonth(dates[dates.length - 1], source.billingDay) : dates[dates.length - 1].slice(0, 7);
    out.push({ ok: true, text: (source.kind === 'card' ? 'החיוב של ' : 'החודש: ') + monthName(key) + ' ' + key.slice(0, 4), key });
  }
  const sum = kept.filter((t) => t.type !== 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  out.push({ ok: kept.length > 0, text: kept.length + ' תנועות, סה״כ ₪' + Math.round(sum).toLocaleString('en-US') });
  const charges = items.filter((t) => t.cardCharge).length;
  if (source.kind === 'bank' && charges) out.push({ ok: true, text: charges + ' חיובי כרטיסי אשראי לא נספרים כאן: הקניות עצמן נספרות מפירוט הכרטיס, ולא פעמיים' });
  const dupes = items.filter((t) => t.dupe && !t.include).length;
  if (dupes) out.push({ ok: null, text: dupes + ' תנועות כבר קיימות מפירוט קודם: לא יישמרו שוב' });
  return out;
}

// Lines of a file that are already saved (the same file saved twice, or from
// two tabs): out, one for one, so two real purchases on the same day for the
// same amount both stay when only one of them was saved before. Pure.
export function withoutSaved(rows, saved) {
  const key = (t) => [t.tx_date, Number(t.amount).toFixed(2), String(t.description || '').trim(), t.card_id || '', t.account_id || '', t.type || 'expense'].join('|');
  const left = new Map();
  for (const t of saved || []) left.set(key(t), (left.get(key(t)) || 0) + 1);
  return (rows || []).filter((r) => {
    const k = key(r), n = left.get(k) || 0;
    if (n > 0) { left.set(k, n - 1); return false; }
    return true;
  });
}
