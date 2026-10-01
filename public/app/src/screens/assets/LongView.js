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

export function LongView({ data, market, marketError, onOpen }) {
  const inv = data.investments.filter((i) => !isLongTerm(i));
  const pension = data.investments.filter(isLongTerm);
  return html`<div class="stack">
    <${Section} title="השקעות" kind="investment" list=${inv} market=${market} onOpen=${onOpen} addLabel="+ השקעה" empty="עוד אין השקעות. אפשר להוסיף קרן, מניה או תיק, עם סימול למחיר חי או עם שווי ידני." />
    <${Section} title="פנסיה והשתלמות" kind="pension" list=${pension} market=${market} onOpen=${onOpen} addLabel="+ קרן" empty="הוסיפו את קרן הפנסיה וקרן ההשתלמות, עם השווי מהדוח השנתי." />
    ${marketError && html`<span class="faint" style="font-size:12px">מחירים חיים לא זמינים כרגע. מוצג השווי האחרון שהוזן.</span>`}
  </div>`;
}
