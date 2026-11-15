import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { isLongTerm, investmentValue, gain } from '../../domain/assets.js';
import { AssetRow } from './AssetRow.js';

function Section({ title, list, market, onOpen, empty, addLabel, kind }) {
  return html`<section class="stack" style="gap:8px">
    <div class="sec-row"><h2 class="section-h">${title}</h2><button type="button" class="btn-text" onClick=${() => onOpen(kind)}>${addLabel}</button></div>
    ${list.length === 0
      ? html`<div class="card muted" style="font-size:14px">${empty}</div>`
      : html`<div class="list">${list.map((i) => {
          const v = investmentValue(i, market);
          const g = gain(i, v.value);
          const sub = [i.asset_type, v.live ? 'מחיר חי' + (v.changePct != null ? ' · היום ' + (v.changePct >= 0 ? '+' : '') + v.changePct.toFixed(1) + '%' : '') : null,
            g ? (g.amount >= 0 ? 'רווח ' : 'הפסד ') + money(g.amount) + ' (' + Math.abs(g.pct).toFixed(1) + '%)' : null].filter(Boolean).join(' · ');
          return html`<${AssetRow} key=${i.id} icon=${isLongTerm(i) ? '☂️' : '📈'} title=${i.name} sub=${sub} amount=${money(v.value)} onClick=${() => onOpen('investment', i.id)} />`;
        })}</div>`}
  </section>`;
}

const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const dmy = (iso) => { const [y, m, d] = iso.split('-').map(Number); return d + '.' + m + '.' + y; };

// What went into investments each month, worked out from the lines sorted to
// "השקעות": nothing to type. What was put in, not what it is worth now.
function Deposits({ d }) {
  if (!d.any) return null;
  const top = Math.max(1, ...d.byMonth.map((m) => m.amount));
  return html`<section class="card stack invest-deposits" aria-label="הפקדות להשקעות">
    <div class="sec-row"><b>הפקדות להשקעות</b><span class="faint" style="font-size:12px">לפי התנועות, מתעדכן לבד</span></div>
    <div class="dep-boxes">
      <div><small>בממוצע בחודש</small><b class="num">${money(d.monthlyAvg)}</b></div>
      <div><small>החודש עד עכשיו</small><b class="num">${money(d.thisMonth)}</b></div>
      <div><small>ב-12 החודשים האחרונים</small><b class="num">${money(d.lastYear)}</b></div>
    </div>
    <div class="dep-bars" role="img" aria-label=${'הפקדות ב-6 החודשים האחרונים: ' + d.byMonth.map((m) => MONTHS[Number(m.ym.slice(5)) - 1] + ' ' + money(m.amount)).join(', ')}>
      ${d.byMonth.map((m) => html`<span class="dep-bar"><i style=${'height:' + Math.round((m.amount / top) * 100) + '%'}></i><small>${MONTHS[Number(m.ym.slice(5)) - 1]}</small></span>`)}
    </div>
    ${d.where.length > 0 && html`<ul class="dep-where">${d.where.map((w) => html`<li key=${w.name}><span>${w.name}</span><b class="num">${money(w.amount)}</b></li>`)}</ul>`}
    <span class="muted" style="font-size:13px;line-height:1.55">סה"כ ${money(d.total)} מאז ${dmy(d.first)}${d.withdrawn > 0 ? ', ומשכתם ' + money(d.withdrawn) : ''}. זה מה שיצא מהחשבון להשקעות, בלי הרווח או ההפסד. כדי לראות כמה זה שווה היום, מוסיפים את ההשקעה למטה עם השווי מהדוח או סימול למחיר חי.</span>
  </section>`;
}

export function LongView({ data, market, marketError, onOpen, deposits = null }) {
  const inv = data.investments.filter((i) => !isLongTerm(i));
  const pension = data.investments.filter(isLongTerm);
  return html`<div class="stack">
    ${deposits && html`<${Deposits} d=${deposits} />`}
    <${Section} title="השקעות" kind="investment" list=${inv} market=${market} onOpen=${onOpen} addLabel="+ השקעה" empty="עוד אין השקעות. אפשר להוסיף קרן, מניה או תיק, עם סימול למחיר חי או עם שווי ידני." />
    <${Section} title="פנסיה והשתלמות" kind="pension" list=${pension} market=${market} onOpen=${onOpen} addLabel="+ קרן" empty="הוסיפו את קרן הפנסיה וקרן ההשתלמות, עם השווי מהדוח השנתי." />
    ${marketError && html`<span class="faint" style="font-size:12px">מחירים חיים לא זמינים כרגע. מוצג השווי האחרון שהוזן.</span>`}
  </div>`;
}
