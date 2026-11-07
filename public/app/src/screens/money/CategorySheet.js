import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { TxRow } from './TxRow.js';
import { monthShare, topCategoryId, MONTH_NAMES } from '../../domain/money.js';
import { monthlySeries, spendStats } from '../../domain/spend.js';
import { catColor } from '../../domain/colors.js';
import { money } from '../../domain/format.js';

// One category over the last 12 months; a sub-category can be picked to see
// it alone (fuel within the car): the year's total, a month on average, the
// dearest month, the bars and its transactions.
export function CategorySheet({ categoryId, txs, categories, budgets, months, onOpenTx, onClose }) {
  const [sub, setSub] = useState('');
  const byId = new Map(categories.map((c) => [c.id, c]));
  const cat = byId.get(categoryId);
  const inCat = (t) => topCategoryId(t, byId) === categoryId;
  const match = (t) => inCat(t) && (!sub || t.subcategory_id === sub);
  // Sub-categories that had spending this year, the biggest first.
  const subs = categories.filter((c) => c.parent_id === categoryId)
    .map((c) => ({ c, total: monthlySeries(txs, months, (t) => inCat(t) && t.subcategory_id === c.id).reduce((s, v) => s + v, 0) }))
    .filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  const series = monthlySeries(txs, months, match);
  const st = spendStats(series, months);
  const budget = sub ? 0 : Number((budgets.find((b) => b.category_id === categoryId) || {}).monthly_amount) || 0;
  const max = Math.max(1, budget, ...series) * 1.1;
  const list = txs.filter((t) => t.type !== 'income' && match(t) && months.some((mo) => monthShare(t, mo) > 0))
    .sort((a, b) => (a.tx_date < b.tx_date ? 1 : -1));
  const color = catColor(categoryId);
  return html`<${Sheet} title=${(cat && cat.name) || 'קטגוריה'} onClose=${onClose}>
    ${subs.length > 0 && html`<div class="chips cat-subs" role="group" aria-label="תת קטגוריה">
      <button type="button" class="chip" aria-pressed=${String(!sub)} onClick=${() => setSub('')}>הכול</button>
      ${subs.map(({ c }) => html`<button type="button" class="chip" key=${c.id} aria-pressed=${String(sub === c.id)} onClick=${() => setSub(c.id)}>${c.name}</button>`)}
    </div>`}
    <div class="kpis spend-kpis">
      <div class="kpi"><small>ב-12 חודשים</small><b class="num">${money(st.total)}</b></div>
      <div class="kpi"><small>ממוצע לחודש</small><b class="num">${money(st.avg)}</b></div>
      <div class="kpi"><small>הכי יקר</small><b>${st.topMonth || '—'}</b></div>
    </div>
    <div style="position:relative;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:4px;align-items:end;height:130px">
      ${budget > 0 && html`<span title="תקציב חודשי" style=${'position:absolute;inset-inline:0;bottom:' + Math.round((budget / max) * 110 + 18) + 'px;border-top:1.5px dashed var(--muted)'}></span>`}
      ${series.map((v, i) => html`<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;height:130px">
        <span style=${'width:100%;max-width:22px;border-radius:5px;height:' + Math.max(3, Math.round((v / max) * 110)) + 'px;background:' + color + (i === st.topIndex ? ';opacity:.7' : '')} title=${MONTH_NAMES[months[i].m] + ': ' + money(v)}></span>
        <small style="font-size:9px;color:var(--faint)">${MONTH_NAMES[months[i].m].slice(0, 3)}</small>
      </div>`)}
    </div>
    <span class="faint" style="font-size:12px">12 החודשים האחרונים${budget > 0 ? ' · הקו המקווקו הוא התקציב החודשי (' + money(budget) + ')' : ''}</span>
    <b style="font-size:13px;color:var(--muted)">התנועות (${list.length})</b>
    ${list.length ? html`<div class="list">${list.slice(0, 80).map((tx) => html`<${TxRow} key=${tx.id} tx=${tx} categoriesById=${byId} showDate=${true} onOpen=${onOpenTx} />`)}</div>`
      : html`<div class="empty">אין תנועות ב-12 החודשים האחרונים</div>`}
  <//>`;
}
