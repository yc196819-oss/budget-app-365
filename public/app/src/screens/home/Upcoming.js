import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';

export function Upcoming({ items }) {
  return html`<section class="stack" style="gap:8px" aria-labelledby="up-h">
    <h2 id="up-h" class="section-h">בשבועיים הקרובים</h2>
    ${items.length === 0
      ? html`<div class="card muted" style="font-size:14px">אין תשלומים קבועים או חיובי אשראי צפויים.</div>`
      : html`<div class="list">${items.map((u) => html`<div class="row" key=${u.date + u.title}>
          <span class="up-date num">${u.label}</span>
          <span class="row-main"><b>${u.title}</b><span>${u.detail}</span></span>
          <b class=${'amt num' + (u.amount > 0 ? ' income' : '')}>${u.amount == null ? 'לפי הפירוט' : (u.amount > 0 ? '+' : '−') + money(u.amount)}</b>
        </div>`)}</div>`}
  </section>`;
}
