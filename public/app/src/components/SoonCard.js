import { html } from '../lib/html.js';

// What a screen will contain, until its stage is built.
export function SoonCard({ stage, title, items }) {
  return html`
    <section class="card soon rise">
      <span class="soon-badge">${stage}</span>
      <b style="font-size:17px">${title}</b>
      <ul>${items.map((i) => html`<li>${i}</li>`)}</ul>
    </section>`;
}
