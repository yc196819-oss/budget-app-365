// "What it means for you" under each morning-news item, from the household's
// own numbers, computed on the device (nothing is sent anywhere for it).
// Returns a sentence, or null when the data has nothing to say (the item's
// general line shows instead). Pure.
import { money } from './format.js';

const ym = (d) => d.getFullYear() * 12 + d.getMonth();
const monthOf = (iso) => { const [y, m] = String(iso).split('-').map(Number); return y * 12 + (m - 1); };

// Average a month over months [from, to] back from this month (1 = last month).
function monthly(txs, test, today, from, to) {
  const now = ym(today);
  const sum = txs.filter((t) => { const k = now - monthOf(t.tx_date); return k >= from && k <= to && test(t); }).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  return sum / (to - from + 1);
}

export function personalLine(topic, data, today = new Date()) {
  const txs = data.txs || [];
  const catName = new Map((data.categories || []).map((c) => [c.id, c.name]));
  const cat = (t) => (catName.get(t.subcategory_id) || '') + ' ' + (catName.get(t.category_id) || '');
  const pct = (a, b) => Math.round(((a - b) / b) * 100);

  if (topic === 'prices') {
    const food = (t) => t.type !== 'income' && /סופר|מכולת|מזון|אוכל לבית|קניות לבית/.test(cat(t) + ' ' + (t.description || ''));
    const now = monthly(txs, food, today, 1, 3), before = monthly(txs, food, today, 12, 14);
    if (now > 0 && before > 0) return `ההוצאה שלכם על מכולת: ${money(now)} בחודש בממוצע בשלושת החודשים האחרונים, לעומת ${money(before)} לפני שנה (${pct(now, before) >= 0 ? '+' : ''}${pct(now, before)}%).`;
    if (now > 0) return `ההוצאה שלכם על מכולת: כ-${money(now)} בחודש בשלושת החודשים האחרונים.`;
    return null;
  }
  if (topic === 'rate' || topic === 'housing') {
    const loan = (t) => t.type !== 'income' && /משכנתא|הלוואה|הלוואות/.test(cat(t) + ' ' + (t.description || ''));
    const pay = monthly(txs, loan, today, 1, 2);
    if (pay > 0) return `יש לכם החזרי משכנתא או הלוואה של כ-${money(pay)} בחודש. אם חלק מהם בריבית משתנה (פריים), שינוי בריבית ישנה את ההחזר.`;
    return null;
  }
  if (topic === 'currency') {
    const trip = (data.goals || []).find((g) => g.icon === '✈️' && g.target_date && new Date(g.target_date) > today);
    const usd = (data.investments || []).filter((i) => i.currency && i.currency !== 'ILS');
    if (trip) return `תכננתם ${trip.name} (${money(trip.target_amount)}): שינוי בשער המטבע משנה כמה החופשה תעלה בשקלים.`;
    if (usd.length) return `יש לכם השקעות במטבע חוץ: שינוי בשער משנה את שוויין בשקלים, גם כשהן עצמן לא זזו.`;
    return null;
  }
  if (topic === 'jobs') {
    const inc = (t) => t.type === 'income';
    const now = monthly(txs, inc, today, 1, 3), before = monthly(txs, inc, today, 12, 14);
    if (now > 0 && before > 0) return `ההכנסות שלכם: ${money(now)} בחודש בממוצע לאחרונה, לעומת ${money(before)} לפני שנה (${pct(now, before) >= 0 ? '+' : ''}${pct(now, before)}%).`;
    return null;
  }
  if (topic === 'energy') {
    const fuel = (t) => t.type !== 'income' && /דלק|חשמל|גז|רכב/.test(cat(t) + ' ' + (t.description || ''));
    const now = monthly(txs, fuel, today, 1, 3);
    if (now > 0) return `אתם מוציאים כ-${money(now)} בחודש על דלק, חשמל ורכב. שינוי מחירים כאן מורגש מהר בתקציב.`;
    return null;
  }
  return null;
}
