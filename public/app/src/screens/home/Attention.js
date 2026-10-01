import { html } from '../../lib/html.js';

const TONE = { danger: 'var(--danger)', warn: 'var(--warn)', accent: 'var(--accent)' };

export function Attention({ items, onAct }) {
  if (!items.length) return null;
  return html`<section class="stack" style="gap:8px" aria-labelledby="att-h">
    <h2 id="att-h" class="section-h">דורש תשומת לב</h2>
    ${items.map((a) => html`<div class="card att rise" key=${a.kind + a.title} style=${'--tone:' + TONE[a.tone]}>
      <span class="att-dot" aria-hidden="true"></span>
      <span class="att-main"><b>${a.title}</b><span>${a.detail}</span>
        <button type="button" class="att-btn" onClick=${() => onAct(a.action)}>${a.action.label}</button></span>
    </div>`)}
  </section>`;
}
