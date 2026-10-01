import { html } from '../../lib/html.js';
import { CatIcon } from '../../components/CatIcon.js';
import { categoryRows } from '../../domain/money.js';
import { catColor } from '../../domain/colors.js';
import { money } from '../../domain/format.js';

export function CategoriesView({ txs, categories, budgets, periodMonths, period, onOpenCategory }) {
  const rows = categoryRows(txs, categories, budgets, periodMonths);
  const total = rows.reduce((s, r) => s + r.spent, 0);
  if (!rows.length) return html`<div class="card empty">אין הוצאות בתקופה הזו.</div>`;
  const byId = new Map(categories.map((c) => [c.id, c]));
  return html`<div class="stack">
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <span style="display:flex;justify-content:space-between;align-items:baseline"><span class="muted" style="font-size:13px;font-weight:700">סה״כ הוצאות</span><b class="num" style="font-size:22px">${money(total)}</b></span>
      <span style="display:flex;height:12px;border-radius:999px;overflow:hidden;gap:2px">
        ${rows.filter((r) => r.spent > 0).map((r) => html`<span title=${r.name} style=${'width:' + ((r.spent / total) * 100).toFixed(1) + '%;background:' + catColor(r.id)}></span>`)}
      </span>
      ${period === 'year' && html`<span class="faint" style="font-size:12px">מול תקציב שנתי (התקציב החודשי × 12)</span>`}
    </div>
    <div class="list">
      ${rows.map((r) => html`<button type="button" class="row" key=${r.id || 'none'} onClick=${() => r.id && onOpenCategory(r.id)}>
        <${CatIcon} category=${byId.get(r.id) || { name: r.name }} />
        <span class="row-main" style="gap:5px">
          <span style="display:flex;justify-content:space-between;font-size:15px;color:var(--text)"><b>${r.name}</b><b class="num">${money(r.spent)}</b></span>
          ${r.budget > 0 && html`<span class="bar"><span style=${'width:' + r.pct + '%;background:' + (r.over ? 'var(--danger)' : catColor(r.id))}></span></span>`}
          <span style=${'display:flex;justify-content:space-between;font-size:12px;color:' + (r.over ? 'var(--danger)' : 'var(--faint)')}>
            <span style="font-weight:700">${r.budget > 0 ? (r.over ? 'חריגה של ' + money(r.spent - r.budget) : 'נשארו ' + money(r.budget - r.spent)) : 'אין תקציב לקטגוריה'}</span>
            ${r.budget > 0 && html`<span class="faint">מתוך ${money(r.budget)}</span>`}
          </span>
        </span>
      </button>`)}
    </div>
  </div>`;
}
