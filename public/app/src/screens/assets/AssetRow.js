import { html } from '../../lib/html.js';

export function AssetRow({ icon, title, sub, amount, tone, onClick }) {
  const body = html`<span class="cat-icon" style="background:var(--surface-2)" aria-hidden="true">${icon}</span>
    <span class="row-main"><b>${title}</b>${sub && html`<span>${sub}</span>`}</span>
    <b class="amt num" style=${tone ? 'color:' + tone : ''}>${amount}</b>`;
  return onClick ? html`<button type="button" class="row" onClick=${onClick}>${body}</button>` : html`<div class="row">${body}</div>`;
}
