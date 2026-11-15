import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { CountUp } from '../../components/CountUp.js';

const signedMoney = (v) => (v < 0 ? '−' : '') + money(v);

export function AssetsHero({ view, s, homes = null, deposits = null }) {
  if (homes) {
    return html`<section class="hero rise">
      <span style="font-weight:700;color:var(--hero-muted)">השווי שלכם בדירות</span>
      <span class="display num" style="font-size:44px;line-height:1"><${CountUp} value=${homes.equity} format=${signedMoney} /></span>
      <div class="hero-boxes">
        <div><small>נשאר במשכנתאות</small><b class="num">${money(homes.owed)}</b></div>
        <div><small>מהדירות הנוספות בחודש</small><b class="num">${signedMoney(homes.cash)}</b></div>
      </div>
    </section>`;
  }
  const long = view === 'long';
  // No investment typed in yet, but deposits in the lines: what was put in.
  const byDeposits = long && s.invest + s.longTerm === 0 && deposits && deposits.any;
  return html`<section class="hero rise">
    <span style="font-weight:700;color:var(--hero-muted)">${byDeposits ? 'הופקד להשקעות (לפי התנועות)' : long ? 'החיסכון לטווח ארוך' : 'השווי הנקי'}</span>
    <span class="display num" style="font-size:44px;line-height:1"><${CountUp} value=${byDeposits ? deposits.net : long ? s.invest + s.longTerm : s.net} format=${long ? money : signedMoney} /></span>
    <div class="hero-boxes">
      ${byDeposits
        ? html`<div><small>בממוצע בחודש</small><b class="num">${money(deposits.monthlyAvg)}</b></div><div><small>ב-12 החודשים האחרונים</small><b class="num">${money(deposits.lastYear)}</b></div>`
        : long
        ? html`<div><small>השקעות</small><b class="num">${money(s.invest)}</b></div><div><small>פנסיה והשתלמות</small><b class="num">${money(s.longTerm)}</b></div>`
        : html`<div><small>יש לנו</small><b class="num">${money(s.assets)}</b></div><div><small>אנחנו חייבים</small><b class="num">${money(s.debts)}</b></div>`}
    </div>
  </section>`;
}
