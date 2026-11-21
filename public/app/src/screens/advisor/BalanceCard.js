import { html } from '../../lib/html.js';

const ils = (v) => (v < 0 ? '−' : '') + '₪' + Math.abs(Math.round(v)).toLocaleString('he-IL');

// The advisor's balance as a card: what comes in, what goes out, each with its
// total, and what is left (from the balances given, when there are any).
export function BalanceCard({ balance: b }) {
  const rows = (list) => list.map((x) => html`<div class="bal-row"><span>${x.label}</span><b class="num">${ils(x.amount)}</b></div>`);
  const hasStart = b.start.length > 0;
  return html`<div class="bal-card" role="group" aria-label=${b.title}>
    <b class="bal-title">${b.title}</b>
    ${hasStart && html`<div class="bal-sec">
      <span class="bal-head">יתרות היום</span>
      ${rows(b.start)}
      <div class="bal-row bal-total"><span>סך היתרות</span><b class=${'num' + (b.totalStart < 0 ? ' neg' : '')}>${ils(b.totalStart)}</b></div>
    </div>`}
    <div class="bal-sec">
      <span class="bal-head in">הכנסות</span>
      ${rows(b.income)}
      <div class="bal-row bal-total"><span>סך ההכנסות</span><b class="num pos">${ils(b.totalIncome)}</b></div>
    </div>
    <div class="bal-sec">
      <span class="bal-head out">הוצאות וחיובים</span>
      ${rows(b.expenses)}
      <div class="bal-row bal-total"><span>סך ההוצאות</span><b class="num neg">${ils(b.totalExpenses)}</b></div>
    </div>
    <div class=${'bal-result' + ((hasStart ? b.end : b.net) < 0 ? ' neg' : ' pos')}>
      <span>${hasStart ? 'יישאר בסוף' : 'הכנסות פחות הוצאות'}</span>
      <b class="num">${ils(hasStart ? b.end : b.net)}</b>
    </div>
    ${hasStart && html`<span class="bal-note">הכנסות פחות הוצאות: ${ils(b.net)}</span>`}
    ${b.note && html`<span class="bal-note">${b.note}</span>`}
  </div>`;
}
