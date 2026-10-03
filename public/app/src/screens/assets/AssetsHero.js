import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { CountUp } from '../../components/CountUp.js';

const signedMoney = (v) => (v < 0 ? '−' : '') + money(v);

export function AssetsHero({ view, s }) {
  const long = view === 'long';
  return html`<section class="hero rise">
    <span style="font-weight:700;color:var(--hero-muted)">${long ? 'החיסכון לטווח ארוך' : 'השווי הנקי'}</span>
    <span class="display num" style="font-size:44px;line-height:1"><${CountUp} value=${long ? s.invest + s.longTerm : s.net} format=${long ? money : signedMoney} /></span>
    <div class="hero-boxes">
      ${long
        ? html`<div><small>השקעות</small><b class="num">${money(s.invest)}</b></div><div><small>פנסיה והשתלמות</small><b class="num">${money(s.longTerm)}</b></div>`
        : html`<div><small>יש לנו</small><b class="num">${money(s.assets)}</b></div><div><small>אנחנו חייבים</small><b class="num">${money(s.debts)}</b></div>`}
    </div>
  </section>`;
}
