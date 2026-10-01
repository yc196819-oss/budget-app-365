import { html } from '../../lib/html.js';
import { money, shortDate } from '../../domain/format.js';
import { openLoans, installmentLeft } from '../../domain/assets.js';
import { cardCycle } from '../../domain/home.js';
import { AssetRow } from './AssetRow.js';

const updated = (iso) => { if (!iso) return 'יתרה לא עודכנה'; const d = new Date(iso); return 'עודכן ב-' + d.getDate() + '.' + (d.getMonth() + 1); };

export function DailyView({ data, today, onOpen }) {
  const loans = openLoans(data.loans);
  const insts = data.installments.map((i) => ({ i, ...installmentLeft(i, today) })).filter((x) => x.left > 0);
  return html`<div class="stack">
    <section class="stack" style="gap:8px">
      <div class="sec-row"><h2 class="section-h">חשבונות</h2><button type="button" class="btn-text" onClick=${() => onOpen('account')}>+ חשבון</button></div>
      ${data.accounts.length === 0
        ? html`<div class="card muted" style="font-size:14px">עוד אין חשבון בנק. הוסיפו אחד כדי לראות כמה כסף פנוי יש.</div>`
        : html`<div class="list">${data.accounts.map((a) => html`<${AssetRow} key=${a.id} icon="🏦" title=${a.name} sub=${(a.bank_name ? a.bank_name + ' · ' : '') + updated(a.balance_updated_at)}
            amount=${a.balance === null || a.balance === undefined ? '—' : (Number(a.balance) < 0 ? '−' : '') + money(a.balance)} tone=${Number(a.balance) < 0 ? 'var(--danger)' : ''} onClick=${() => onOpen('account', a.id)} />`)}</div>`}
    </section>
    ${data.cards.length > 0 && html`<section class="stack" style="gap:8px">
      <h2 class="section-h">כרטיסי אשראי</h2>
      <div class="list">${data.cards.map((c) => {
        const cyc = cardCycle(c, data.txs, today);
        return html`<${AssetRow} key=${c.id} icon="💳" title=${c.name} sub=${'יירד ב-' + shortDate(cyc.next) + ' · עוד לא ירד (הערכה)'} amount=${'−' + money(cyc.pending)} />`;
      })}</div>
    </section>`}
    <section class="stack" style="gap:8px">
      <div class="sec-row"><h2 class="section-h">הלוואות וחובות</h2><button type="button" class="btn-text" onClick=${() => onOpen('loan')}>+ הלוואה</button></div>
      ${loans.length === 0
        ? html`<div class="card muted" style="font-size:14px">אין הלוואות פתוחות.</div>`
        : html`<div class="list">${loans.map((l) => html`<${AssetRow} key=${l.id} icon=${l.direction === 'tome' ? '🤝' : '📄'} title=${l.counterparty || 'הלוואה'}
            sub=${(l.direction === 'tome' ? 'חייבים לנו' : 'אנחנו חייבים') + (l.note ? ' · ' + l.note : '')}
            amount=${(l.direction === 'tome' ? '+' : '−') + money(l.amount)} tone=${l.direction === 'tome' ? 'var(--income)' : ''} onClick=${() => onOpen('loan', l.id)} />`)}</div>`}
    </section>
    ${insts.length > 0 && html`<section class="stack" style="gap:8px">
      <h2 class="section-h">תשלומים</h2>
      <div class="list">${insts.map((x) => html`<${AssetRow} key=${x.i.id} icon="🧾" title=${x.i.description || 'תשלומים'} sub=${'נשארו ' + x.left + ' תשלומים של ' + money(x.monthly)} amount=${'−' + money(x.amount)} />`)}</div>
    </section>`}
  </div>`;
}
