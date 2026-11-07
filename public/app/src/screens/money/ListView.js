import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { Segmented } from '../../components/Segmented.js';
import { TxRow } from './TxRow.js';
import { filterTxs, groupByDay, groupByMonth, dayLabel, monthLabel, inMonth, MONTH_NAMES } from '../../domain/money.js';
import { monthlySeries, spendStats } from '../../domain/spend.js';
import { money, signed } from '../../domain/format.js';

const FILTERS = [{ key: 'all', label: 'הכול' }, { key: 'expense', label: 'הוצאות' }, { key: 'income', label: 'הכנסות' }, { key: 'fixed', label: 'קבועות' }];

export function ListView({ txs, months, period, index, categoriesById, onOpen, onAdd, onImport, query: outerQuery, onQuery }) {
  const [ownQuery, setOwnQuery] = useState('');
  const query = onQuery ? outerQuery || '' : ownQuery;
  const setQuery = onQuery || setOwnQuery;
  const [filter, setFilter] = useState('all');
  const [shownMonths, setShownMonths] = useState(2);
  const today = new Date();

  const inPeriod = period === 'year' ? txs.filter((t) => months.some((mo) => inMonth(t, mo))) : txs.filter((t) => inMonth(t, months[index]));
  const visible = filterTxs(inPeriod, { query, filter, categoriesById });
  const filtering = !!query.trim() || filter !== 'all';
  const exp = inPeriod.filter((t) => t.type !== 'income').reduce((s, t) => s + Number(t.amount), 0);
  const inc = inPeriod.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);

  let groups;
  let more = 0;
  if (period === 'year') {
    const all = groupByMonth(visible, months);
    groups = (filtering ? all : all.slice(0, shownMonths)).map((g) => ({ key: g.key, label: monthLabel(g.month), net: g.net, items: g.items }));
    more = filtering ? 0 : all.length - groups.length;
  } else {
    groups = groupByDay(visible).map((g) => ({ key: g.key, label: dayLabel(g.date, today), net: g.net, items: g.items }));
  }

  if (!inPeriod.length) {
    return html`<div class="card empty">
      <b style="font-size:17px;color:var(--text)">${period === 'year' ? 'עוד אין תנועות ב-12 החודשים האחרונים' : 'אין תנועות בחודש הזה'}</b>
      <span>הדרך הכי מהירה: להעלות את הפירוט מהאתר של חברת האשראי. לוקח דקה.</span>
      <button type="button" class="btn" onClick=${onImport}><${Icon} name="upload" />העלאת פירוט כרטיס</button>
      <button type="button" class="btn btn-ghost" onClick=${onAdd}><${Icon} name="plus" />הוספת הוצאה</button>
    </div>`;
  }

  return html`<div class="stack">
    <div class="kpis" style="grid-template-columns:1fr 1fr">
      <div class="kpi"><small>יצא</small><b class="num">−${money(exp)}</b></div>
      <div class="kpi"><small>נכנס</small><b class="num" style="color:var(--income)">+${money(inc)}</b></div>
    </div>
    <label class="search"><span class="visually-hidden">חיפוש</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" /></svg>
      <input type="search" value=${query} onInput=${(e) => setQuery(e.target.value)} placeholder=${period === 'year' ? 'חיפוש בכל השנה' : 'חיפוש בית עסק או קטגוריה'} />
    </label>
    <div class="chips" role="group" aria-label="סינון">
      ${FILTERS.map((f) => html`<button type="button" class="chip" aria-pressed=${String(filter === f.key)} onClick=${() => setFilter(f.key)}>${f.label}</button>`)}
    </div>
    ${query.trim() && visible.length > 0 && html`<${SearchSummary} query=${query.trim()} visible=${visible} months=${months} year=${period === 'year'} />`}
    ${filtering && !query.trim() && html`<span style="font-size:13px;font-weight:800;color:var(--accent);padding:0 4px">נמצאו ${visible.length} תנועות · ${money(visible.filter((t) => t.type !== 'income').reduce((s, t) => s + Number(t.amount), 0))} בהוצאות</span>`}
    ${!visible.length && html`<div class="empty">לא נמצאו תנועות. נסו חיפוש אחר.</div>`}
    ${groups.map((g) => html`<div key=${g.key}>
      <div class="group-head"><span>${g.label}</span><span class="num">${signed(g.net)}</span></div>
      <div class="list">${g.items.map((tx) => html`<${TxRow} key=${tx.id} tx=${tx} categoriesById=${categoriesById} showDate=${period === 'year'} onOpen=${onOpen} />`)}</div>
    </div>`)}
    ${more > 0 && html`<button type="button" class="btn btn-ghost" onClick=${() => setShownMonths(shownMonths + 3)}>להציג עוד ${Math.min(3, more)} חודשים</button>`}
    <button type="button" class="btn btn-dashed" onClick=${onImport}><${Icon} name="upload" size=${18} />העלאת פירוט כרטיס</button>
  </div>`;
}
export { Segmented };

// What a search adds up to: the total, a month on average, how many times,
// and (over 12 months) the bars by month and the dearest month.
function SearchSummary({ query, visible, months, year }) {
  const ids = new Set(visible.map((t) => t.id));
  const exp = visible.filter((t) => t.type !== 'income');
  const series = monthlySeries(visible, months, (t) => ids.has(t.id));
  const st = spendStats(series, months);
  const total = year ? st.total : Math.round(exp.reduce((s, t) => s + Number(t.amount), 0));
  const max = Math.max(1, ...series) * 1.1;
  return html`<div class="card stack search-summary" style="gap:10px">
    <b style="font-size:16px">"${query}" ${year ? 'ב-12 החודשים האחרונים' : 'בחודש הזה'}</b>
    <div class="kpis">
      <div class="kpi"><small>סך הכול</small><b class="num">${money(total)}</b></div>
      ${year ? html`<div class="kpi"><small>ממוצע לחודש</small><b class="num">${money(st.avg)}</b></div>` : ''}
      <div class="kpi"><small>${exp.length === 1 ? 'קנייה' : 'קניות'}</small><b class="num">${exp.length}</b></div>
    </div>
    ${year && html`<div style="display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:4px;align-items:end;height:86px">
      ${series.map((v, i) => html`<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;height:86px">
        <span style=${'width:100%;max-width:18px;border-radius:4px;height:' + Math.max(2, Math.round((v / max) * 66)) + 'px;background:var(--accent)' + (i === st.topIndex ? ';opacity:.7' : '')} title=${MONTH_NAMES[months[i].m] + ': ' + money(v)}></span>
        <small style="font-size:9px;color:var(--faint)">${MONTH_NAMES[months[i].m].slice(0, 3)}</small>
      </div>`)}
    </div>`}
    ${year && st.topMonth && html`<span class="muted" style="font-size:13px">הכי הרבה ב${st.topMonth} (${money(series[st.topIndex])}).</span>`}
  </div>`;
}
