import { html } from '../../lib/html.js';
import { Segmented } from '../../components/Segmented.js';
import { Icon } from '../../components/Icon.js';
import { MONTH_NAMES, monthLabel, totalsFor, monthsBack } from '../../domain/money.js';
import { money } from '../../domain/format.js';

// Month / last-12-months switch, month arrows, and 12 small bars (how much
// went out each month) that jump straight to a month.
export function PeriodBar({ months, period, index, onPeriod, onIndex, txs }) {
  const totals = months.map((mo) => totalsFor(txs, [mo]).expense);
  const max = Math.max(1, ...totals);
  const first = months[0];
  const last = months[months.length - 1];
  return html`
    <${Segmented} label="תקופה" value=${period} onChange=${onPeriod}
      options=${[{ key: 'month', label: 'חודש' }, { key: 'year', label: '12 החודשים האחרונים' }]} />
    <div class="card" style="padding:10px 12px 8px;display:flex;flex-direction:column;gap:8px">
      ${period === 'month'
        ? html`<div class="month-nav">
            <button type="button" class="icon-btn" aria-label="החודש הקודם" disabled=${index === 0} onClick=${() => onIndex(index - 1)}><${Icon} name="back" size=${18} stroke=${2.4} /></button>
            <b>${monthLabel(months[index])}</b>
            <button type="button" class="icon-btn" aria-label="החודש הבא" disabled=${index === months.length - 1} onClick=${() => onIndex(index + 1)}><span style="transform:scaleX(-1);display:flex"><${Icon} name="back" size=${18} stroke=${2.4} /></span></button>
          </div>`
        : html`<b style="text-align:center;font-size:15px;padding:8px 0 2px">${MONTH_NAMES[first.m] + ' ' + first.y + ' – ' + MONTH_NAMES[last.m] + ' ' + last.y}</b>`}
      <div class="strip">
        ${months.map((mo, i) => html`<button type="button" aria-pressed=${String(period === 'year' || i === index)}
            aria-label=${monthLabel(mo) + ': ' + money(totals[i])} title=${monthLabel(mo) + ': ' + money(totals[i])} onClick=${() => onIndex(i, true)}>
          <span class="col" style=${'height:' + Math.max(4, Math.round((totals[i] / max) * 34)) + 'px'}></span>
          <small>${MONTH_NAMES[mo.m].slice(0, 3)}</small>
        </button>`)}
      </div>
    </div>`;
}
export { monthsBack };
