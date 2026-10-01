import { html } from '../../lib/html.js';
import { Sheet } from '../../components/Sheet.js';
import { TxRow } from './TxRow.js';
import { monthShare, topCategoryId, MONTH_NAMES } from '../../domain/money.js';
import { catColor } from '../../domain/colors.js';
import { money } from '../../domain/format.js';

// One category over the last 12 months, and its transactions in the chosen period.
export function CategorySheet({ categoryId, txs, categories, budgets, months, periodMonths, onOpenTx, onClose }) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const cat = byId.get(categoryId);
  const mine = txs.filter((t) => t.type !== 'income' && topCategoryId(t, byId) === categoryId);
  const perMonth = months.map((mo) => mine.reduce((s, t) => s + monthShare(t, mo), 0));
  const budget = Number((budgets.find((b) => b.category_id === categoryId) || {}).monthly_amount) || 0;
  const max = Math.max(1, budget, ...perMonth) * 1.1;
  const inPeriod = mine.filter((t) => periodMonths.some((mo) => monthShare(t, mo) > 0)).sort((a, b) => (a.tx_date < b.tx_date ? 1 : -1));
  const color = catColor(categoryId);
  return html`<${Sheet} title=${(cat && cat.name) || 'קטגוריה'} onClose=${onClose}>
    <div style="position:relative;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:4px;align-items:end;height:130px">
      ${budget > 0 && html`<span title="תקציב חודשי" style=${'position:absolute;inset-inline:0;bottom:' + Math.round((budget / max) * 110 + 18) + 'px;border-top:1.5px dashed var(--muted)'}></span>`}
      ${perMonth.map((v, i) => html`<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;height:130px">
        <span style=${'width:100%;max-width:22px;border-radius:5px;height:' + Math.max(3, Math.round((v / max) * 110)) + 'px;background:' + color}></span>
        <small style="font-size:9px;color:var(--faint)">${MONTH_NAMES[months[i].m].slice(0, 3)}</small>
      </div>`)}
    </div>
    <span class="faint" style="font-size:12px">12 החודשים האחרונים${budget > 0 ? ' · הקו המקווקו הוא התקציב החודשי (' + money(budget) + ')' : ''}</span>
    <b style="font-size:13px;color:var(--muted)">התנועות בתקופה (${inPeriod.length})</b>
    ${inPeriod.length ? html`<div class="list">${inPeriod.slice(0, 60).map((tx) => html`<${TxRow} key=${tx.id} tx=${tx} categoriesById=${byId} showDate=${true} onOpen=${onOpenTx} />`)}</div>`
      : html`<div class="empty">אין תנועות בתקופה הזו</div>`}
  <//>`;
}
