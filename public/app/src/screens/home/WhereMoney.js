import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { catColor } from '../../domain/colors.js';
import { Icon } from '../../components/Icon.js';

export function WhereMoney({ top }) {
  if (!top.rows.length) return null;
  return html`<a class="card where" href="#/money/cats">
    <span style="display:flex;justify-content:space-between;align-items:center"><b>לאן הלך הכסף החודש</b><${Icon} name="back" size=${16} stroke=${2.4} /></span>
    ${top.rows.map((r) => html`<span class="where-row" key=${r.id || 'none'}>
      <span style="display:flex;justify-content:space-between;font-size:14px"><span>${r.icon ? r.icon + ' ' : ''}${r.name}</span><b class="num">${money(r.spent)}</b></span>
      <span class="bar"><span style=${'width:' + r.share + '%;background:' + (r.over ? 'var(--danger)' : catColor(r.id))}></span></span>
    </span>`)}
  </a>`;
}
