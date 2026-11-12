// "The advisor checked the fixed costs": cellular, internet and TV,
// subscriptions and insurance that come every month, what each costs, what
// went up, and a question where there may be something to save. It never
// promises a saving: it points at what is worth checking. Pure.

import { merchantKey } from './money.js';
import { isTransfer } from './transfers.js';

const KINDS = [
  { key: 'cell', name: 'סלולר', re: /פרטנר|סלקום|פלאפון|הוט מובייל|גולן טלקום|רמי לוי תקשורת|we4g|xphone|019 מובייל|012 מובייל|partner|cellcom|pelephone|golan/i },
  { key: 'net', name: 'אינטרנט וטלוויזיה', re: /בזק|הוט|\bhot\b|\byes\b|אינטרנט|ספקית|נטוויז'ן|סלקום tv|פרטנר tv|triple|bezeq/i },
  { key: 'subs', name: 'מנויים', re: /netflix|נטפליקס|disney|דיסני|spotify|ספוטיפיי|apple\.com|itunes|youtube|amazon prime|icloud|google one|deezer|chatgpt|openai|microsoft 365|audible|storytel|מנוי/i },
  { key: 'ins', name: 'ביטוחים', re: /ביטוח|הראל|הפניקס|מנורה מבטחים|ליברה|\baig\b|שירביט|wesure/i }
];
const STREAM = /netflix|נטפליקס|disney|דיסני|youtube|amazon prime|yes\+|hot\+|סלקום tv|apple tv/i;
const HEALTH = /בריאות|health/i;
// The company, for "two health insurances": a health fund's own plan
// (כללית, מכבי…) counts as one too.
const COMPANY = /הראל|מגדל|הפניקס|כללית|כלל(?!ית)|מנורה|איילון|ליברה|\baig\b|שירביט|ביטוח ישיר|מכבי|מאוחדת|לאומית/i;

const ym = (iso) => String(iso).slice(0, 7);
const keyOfMonth = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const round = (n) => Math.round(n * 100) / 100;

// The household's fixed costs of the kinds above: a business charged in at
// least 2 of the last 4 months (or marked fixed) and still charged this
// month or last; its monthly amount (the latest charge) and the one before,
// by kind.
export function fixedCosts(txs, { categories = [], today = new Date() } = {}) {
  const months = new Set([0, 1, 2, 3].map((i) => keyOfMonth(new Date(today.getFullYear(), today.getMonth() - i, 1))));
  const recent = keyOfMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const catName = new Map(categories.map((c) => [c.id, c.name || '']));
  const groups = new Map();
  for (const t of txs || []) {
    if (t.type === 'income' || isTransfer(t) || !(Number(t.amount) > 0) || !months.has(ym(t.tx_date))) continue;
    const text = String(t.description || '') + ' ' + (catName.get(t.subcategory_id) || '') + ' ' + (catName.get(t.category_id) || '');
    const kind = KINDS.find((k) => k.re.test(text));
    if (!kind) continue;
    const key = kind.key + '|' + merchantKey(t.description);
    const g = groups.get(key) || { kind: kind.key, name: String(t.description || '').replace(/\(תשלום[^)]*\)/, '').trim(), text, lines: [], fixed: false };
    g.lines.push(t);
    if (t.nature === 'fixed') g.fixed = true;
    groups.set(key, g);
  }
  const items = [];
  for (const g of groups.values()) {
    const byMonth = new Map();
    for (const t of g.lines) byMonth.set(ym(t.tx_date), (byMonth.get(ym(t.tx_date)) || 0) + Number(t.amount));
    if (byMonth.size < 2 && !g.fixed) continue;
    const ordered = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    // Still charged: this month or the one before (a subscription that
    // stopped, or a policy that ended, is not a cost any more).
    if (ordered[0][0] < recent) continue;
    const monthly = round(ordered[0][1]);
    const before = ordered[1] ? round(ordered[1][1]) : null;
    items.push({ kind: g.kind, name: g.name.slice(0, 40), monthly, before, health: HEALTH.test(g.text), company: (g.text.match(COMPANY) || [])[0] || null, stream: STREAM.test(g.text) });
  }
  return KINDS.map((k) => {
    const list = items.filter((i) => i.kind === k.key).sort((a, b) => b.monthly - a.monthly);
    return { key: k.key, name: k.name, items: list, total: round(list.reduce((s, i) => s + i.monthly, 0)) };
  }).filter((k) => k.items.length);
}

// What is worth a look, in plain words: a price that went up, two streaming
// services, two health insurances from different companies, and a cellular
// bill that may be more than needed. Each with what to do.
export function findings(kinds) {
  const out = [];
  for (const k of kinds) {
    for (const i of k.items) {
      if (i.before && i.monthly - i.before >= 5 && i.monthly > i.before * 1.03) {
        out.push({ id: 'up:' + i.name + ':' + i.monthly, kind: k.key, type: 'up', tag: 'עלה לאחרונה', chip: i.name + ': עלה', text: i.name + ' עלה מ-₪' + fmt(i.before) + ' ל-₪' + fmt(i.monthly) + ' בחודש. שווה לבדוק אם המחיר השתנה בלי הודעה, או שהסתיימה הנחה.' });
      }
    }
    if (k.key === 'subs') {
      const streams = k.items.filter((i) => i.stream);
      if (streams.length >= 2) out.push({ id: 'streams:' + streams.length, kind: k.key, type: 'streams', tag: 'מנוי כפול?', yes: 'משתמשים בכולם', chip: streams.length + ' מנויי סטרימינג', text: streams.length + ' שירותי סטרימינג (₪' + fmt(streams.reduce((s, i) => s + i.monthly, 0)) + ' בחודש). אתם משתמשים בכולם?' });
    }
    if (k.key === 'ins') {
      const health = k.items.filter((i) => i.health && i.company);
      if (new Set(health.map((i) => i.company)).size >= 2) out.push({ id: 'health', kind: k.key, type: 'health', tag: 'ביטוח כפול?', chip: 'ביטוח בריאות כפול?', text: 'ביטוחי בריאות מכמה חברות. לפעמים זה אותו כיסוי פעמיים. ב"הר הביטוח" (אתר רשות שוק ההון, בחינם) רואים את כל הפוליסות שלכם.', link: { label: 'להר הביטוח', url: 'https://harb.cma.gov.il/' } });
    }
    if (k.key === 'cell' && k.total >= 100) out.push({ id: 'cell', kind: k.key, type: 'cell', tag: 'שווה להשוות', chip: 'סלולר: אולי יקר', text: 'הסלולר עולה ₪' + fmt(k.total) + ' בחודש. כמה קווים יש בחשבון? אם זה קו או שניים, שווה להשוות לחבילות של חברות אחרות.' });
  }
  return out;
}
const fmt = (n) => Math.round(n).toLocaleString('en-US');
