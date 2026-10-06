import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { openLoans, installmentLeft } from '../../domain/assets.js';
import { usage, cardLabel, cardSub } from '../../domain/cards.js';
import { AssetRow } from './AssetRow.js';

const updated = (iso) => { if (!iso) return 'יתרה לא עודכנה'; const d = new Date(iso); return 'עודכן ב-' + d.getDate() + '.' + (d.getMonth() + 1); };

export function DailyView({ data, today, onOpen, userId }) {
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
    <section class="stack" style="gap:8px">
      <div class="sec-row"><h2 class="section-h">כרטיסי אשראי</h2><button type="button" class="btn-text" onClick=${() => onOpen('card')}>+ כרטיס</button></div>
      ${data.cards.length === 0
        ? html`<div class="card muted" style="font-size:14px">עוד אין כרטיס. הוסיפו כרטיס כדי לראות מתי יורד החיוב וכמה כבר הצטבר.</div>`
        : html`<div class="list">${data.cards.map((c) => html`<${CardRow} key=${c.id} card=${c} u=${usage(c, data.txs, today)} members=${data.members} userId=${userId} onClick=${() => onOpen('card', c.id)} />`)}</div>`}
    </section>
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

// One card: the amount waiting to be charged and, with a limit, how much of
// it is used (amber from 80%, red over the limit).
function CardRow({ card, u, members, userId, onClick }) {
  const tone = u.level === 'over' ? 'var(--danger)' : u.level === 'near' ? 'var(--warn, #c98a12)' : 'var(--accent)';
  return html`<button type="button" class="row card-row" onClick=${onClick}>
    <span class="cat-icon" style="background:var(--surface-2)" aria-hidden="true">💳</span>
    <span class="row-main"><b>${cardLabel(card)}</b><span>${cardSub(card, u.cyc, members, userId)} · עוד לא ירד (הערכה)</span>
      ${u.limit !== null && html`<span class="card-limit">
        <span class="bar" role="meter" aria-label="ניצול המסגרת" aria-valuemin="0" aria-valuemax=${u.limit} aria-valuenow=${Math.round(u.used)}><span style=${'width:' + Math.min(100, Math.round(u.ratio * 100)) + '%;background:' + tone}></span></span>
        <span style=${u.level === 'ok' ? '' : 'color:' + tone}>${u.level === 'over' ? 'חריגה של ' + money(-u.left) + ' מהמסגרת' : 'נשארו ' + money(u.left) + ' מתוך ' + money(u.limit)}</span>
      </span>`}</span>
    <b class="amt num">${'−' + money(u.used)}</b>
  </button>`;
}
