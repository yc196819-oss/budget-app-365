import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';

const TONE = { danger: 'var(--danger)', warn: 'var(--warn)', accent: 'var(--accent)' };

// limit: show the first few, the rest behind "עוד N".
export function Attention({ items: all, onAct, limit = 0 }) {
  const [more, setMore] = useState(false);
  if (!all.length) return null;
  const items = limit && !more ? all.slice(0, limit) : all;
  return html`<section class="stack" style="gap:8px" aria-labelledby="att-h">
    <h2 id="att-h" class="section-h">דורש תשומת לב</h2>
    ${items.map((a) => html`<div class="card att rise" key=${a.kind + a.title} style=${'--tone:' + TONE[a.tone]}>
      <span class="att-dot" aria-hidden="true"></span>
      <span class="att-main"><b>${a.title}</b><span>${a.detail}</span>
        <span class="att-actions"><button type="button" class="att-btn" onClick=${() => onAct(a.action)}>${a.action.label}</button>
        ${a.second && html`<button type="button" class="att-btn att-btn2" onClick=${() => onAct(a.second)}>${a.second.label}</button>`}</span></span>
    </div>`)}
    ${limit > 0 && all.length > limit && html`<button type="button" class="btn-text att-more" onClick=${() => setMore((v) => !v)}>${more ? 'פחות' : 'עוד ' + (all.length - limit)}</button>`}
  </section>`;
}
