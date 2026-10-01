import { html } from '../../lib/html.js';
import { categoryRows, totalsFor, MONTH_NAMES } from '../../domain/money.js';
import { catColor } from '../../domain/colors.js';
import { money, signed } from '../../domain/format.js';

export function ReportView({ txs, categories, budgets, periodMonths, period }) {
  const t = totalsFor(txs, periodMonths);
  const rows = categoryRows(txs, categories, budgets, periodMonths).slice(0, 5);
  const top = rows.length ? rows[0].spent : 1;
  const perMonth = periodMonths.map((mo) => ({ mo, ...totalsFor(txs, [mo]) }));
  const maxSpent = Math.max(1, ...perMonth.map((x) => x.expense));
  const neg = perMonth.filter((x) => x.net < 0).length;
  return html`<div class="stack">
    <div class="kpis">
      <div class="kpi"><small>נכנס</small><b class="num" style="color:var(--income)">${money(t.income)}</b></div>
      <div class="kpi"><small>יצא</small><b class="num">${money(t.expense)}</b></div>
      <div class="kpi"><small>נשאר</small><b class="num" style=${'color:' + (t.net < 0 ? 'var(--danger)' : 'var(--income)')}>${signed(t.net)}</b></div>
    </div>
    ${period === 'year' && html`<div class="card" style="display:flex;flex-direction:column;gap:10px">
      <b style="font-size:14px;color:var(--muted)">כמה נשאר בסוף כל חודש</b>
      <div class="strip" style="height:120px">
        ${perMonth.map((x) => html`<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;height:120px">
          <small class="num" style=${'font-size:9px;font-weight:800;color:' + (x.net < 0 ? 'var(--danger)' : 'var(--income)')}>${(x.net < 0 ? '−' : '+') + (Math.abs(x.net) >= 1000 ? (Math.abs(x.net) / 1000).toFixed(1) + 'K' : Math.round(Math.abs(x.net)))}</small>
          <span class="col" style=${'height:' + Math.max(4, Math.round((x.expense / maxSpent) * 80)) + 'px;width:100%;max-width:24px;border-radius:6px;background:' + (x.net < 0 ? 'var(--danger)' : 'var(--income)')}></span>
          <small>${MONTH_NAMES[x.mo.m].slice(0, 3)}</small>
        </div>`)}
      </div>
      <span class="faint" style="font-size:12px">גובה העמודה: כמה יצא · ירוק נגמר בפלוס, אדום במינוס · ${neg} מתוך 12 חודשים במינוס</span>
    </div>`}
    ${rows.length > 0 && html`<div class="card" style="display:flex;flex-direction:column;gap:10px">
      <b style="font-size:14px;color:var(--muted)">הקטגוריות הגדולות</b>
      ${rows.map((r) => html`<div style="display:flex;align-items:center;gap:10px;font-size:14px">
        <span style="width:96px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.name}</span>
        <span class="bar" style="flex:1;height:10px"><span style=${'width:' + Math.round((r.spent / top) * 100) + '%;background:' + catColor(r.id)}></span></span>
        <b class="num" style="width:76px;text-align:left">${money(r.spent)}</b>
      </div>`)}
    </div>`}
  </div>`;
}
