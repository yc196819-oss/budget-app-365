import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';

const short = (v) => (v < 0 ? '−' : '') + '₪' + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'K' : Math.round(Math.abs(v)));

// One bar per month, above or below a zero line. With a "what if" running,
// the bars without it show as outlines.
export function ForecastBars({ months, base, hasBalance }) {
  const val = (m) => (hasBalance ? m.end : m.net);
  const all = [...months, ...(base || [])].map((m) => Math.abs(val(m)));
  const max = Math.max(1, ...all);
  const h = (v, room) => Math.max(4, Math.round((Math.abs(v) / max) * room)) + 'px';
  return html`<div class="card stack" style="gap:10px">
    <b style="font-size:14px">${hasBalance ? 'כמה יישאר בעו״ש בסוף כל חודש' : 'כמה יישאר מכל חודש'}</b>
    <div class="fc-bars" role="img" aria-label=${months.map((m) => m.short + ' ' + money(val(m))).join(', ')}>
      ${months.map((m, i) => {
        const v = val(m);
        const b = base ? val(base[i]) : null;
        return html`<div class="fc-col" key=${i}>
          <div class="fc-up">${v >= 0 && html`<span class="num">${short(v)}</span><span class="fc-bar" style=${'height:' + h(v, 88) + ';background:var(--income)'}></span>`}
            ${b !== null && b >= 0 && html`<span class="fc-ghost" style=${'height:' + h(b, 88)}></span>`}</div>
          <div class="fc-zero"></div>
          <div class="fc-down">${v < 0 && html`<span class="fc-bar" style=${'height:' + h(v, 44) + ';background:var(--danger)'}></span><span class="num" style="color:var(--danger)">${short(v)}</span>`}
            ${b !== null && b < 0 && html`<span class="fc-ghost" style=${'height:' + h(b, 44)}></span>`}</div>
          <small>${m.short}</small>
        </div>`;
      })}
    </div>
  </div>`;
}
