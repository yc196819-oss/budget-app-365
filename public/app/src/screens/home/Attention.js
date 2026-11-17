import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { money } from '../../domain/format.js';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// A recurring payment that got dearer: the old price crossed out, the new
// one big, and what it costs over a year.
function Rise({ a, onAct }) {
  const r = a.rise;
  return html`<div class="card att-rise rise" style="--tone:var(--warn)">
    <div class="ar-top"><span class="ar-ic" aria-hidden="true"><${Icon} name="chart" size=${20} /></span>
      <span class="ar-t"><b>${a.title}</b><small>תשלום קבוע${r.since != null ? ' · מ' + MONTHS[r.since] : ''}</small></span>
      <span class="ar-pct" dir="ltr">+${r.pct}%</span></div>
    <div class="ar-price"><s class="num">${money(r.from)}</s><span aria-hidden="true">←</span><b class="num">${money(r.to)}</b><small>לחודש</small></div>
    <div class="ar-year"><bdi>${money(r.perYear)}</bdi> יותר בשנה</div>
    <div class="ar-acts"><button type="button" class="btn" onClick=${() => onAct(a.action)}>${a.action.label}</button>
      <button type="button" class="btn btn-ghost" onClick=${() => onAct(a.second)}>${a.second.label}</button></div>
  </div>`;
}

const TONE = { danger: 'var(--danger)', warn: 'var(--warn)', accent: 'var(--accent)' };

// limit: show the first few, the rest behind "עוד N".
export function Attention({ items: all, onAct, limit = 0 }) {
  const [more, setMore] = useState(false);
  if (!all.length) return null;
  const items = limit && !more ? all.slice(0, limit) : all;
  return html`<section class="stack" style="gap:8px" aria-labelledby="att-h">
    <h2 id="att-h" class="section-h">דורש תשומת לב</h2>
    ${items.map((a) => a.kind === 'rise' ? html`<${Rise} key=${a.kind + a.title} a=${a} onAct=${onAct} />` : html`<div class="card att rise" key=${a.kind + a.title} style=${'--tone:' + TONE[a.tone]}>
      <span class="att-dot" aria-hidden="true"></span>
      <span class="att-main"><b>${a.title}</b><span>${a.detail}</span>
        <span class="att-actions"><button type="button" class="att-btn" onClick=${() => onAct(a.action)}>${a.action.label}</button>
        ${a.second && html`<button type="button" class="att-btn att-btn2" onClick=${() => onAct(a.second)}>${a.second.label}</button>`}</span></span>
    </div>`)}
    ${limit > 0 && all.length > limit && html`<button type="button" class="btn-text att-more" onClick=${() => setMore((v) => !v)}>${more ? 'פחות' : 'עוד ' + (all.length - limit)}</button>`}
  </section>`;
}
