import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { forecast, verdict, cutIdeas } from '../../domain/forecast.js';
import { cashNow } from '../../domain/home.js';
import { money } from '../../domain/format.js';
import { PlanCards } from './PlanCards.js';
import { ForecastBars } from './ForecastBars.js';
import { WhatIf } from './WhatIf.js';

const TONE = { ok: 'var(--income)', warn: 'var(--warn)', danger: 'var(--danger)' };
const signedMoney = (v) => (v < 0 ? '−' : '+') + money(v);

// One sentence, up to two actions, simple bars, then month by month.
export function ComingMonths({ data, onSheet, onBudget }) {
  const [open, setOpen] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const today = new Date();
  const cash = cashNow(data.accounts, data.cards, data.txs, today);
  const args = { txs: data.txs, goals: data.goals, installments: data.installments, budgets: data.budgets, today, startBalance: cash.known ? cash.free : null };
  const fc = forecast({ ...args, scenarios });
  const base = scenarios.length ? forecast(args) : null;
  const v = verdict(fc);
  const gap = -fc.regularNet;
  const ideas = gap > 0 ? cutIdeas(data.txs, data.categories, data.budgets, today) : [];

  if (!fc.base.income && !fc.base.variable) {
    return html`<div class="card empty">אחרי חודש מלא של תנועות תופיע כאן תחזית לחצי השנה הקרובה.</div>`;
  }
  return html`<div class="stack">
    <div class="card verdict rise" style=${'--tone:' + TONE[v.tone]}>
      <b>${v.title}</b><span>${v.text}</span>
    </div>
    ${gap > 0 && html`<div class="card stack" style="gap:8px">
      <b style="font-size:13px;color:var(--muted)">מה כדאי לעשות</b>
      <b>לסגור פער של ${money(gap)} בחודש</b>
      <span class="muted" style="font-size:14px;line-height:1.5">${ideas.length
        ? 'הכי קל להתחיל ב' + ideas.map((i) => i.name + ' (כ-' + money(i.avg) + ' בחודש' + (i.over ? ', מעל התקציב' : '') + ')').join(' וב') + '. אפשר לבדוק למטה איך חיסכון ישפיע, בלי לשנות כלום.'
        : 'אפשר לבדוק למטה איך חיסכון או שינוי בהכנסה ישפיעו, בלי לשנות כלום.'}</span>
      <button type="button" class="att-btn" style="--tone:var(--accent)" onClick=${onBudget}>לתקציב</button>
    </div>`}
    <${PlanCards} data=${data} onSheet=${onSheet} />
    <${ForecastBars} months=${fc.months} base=${base && base.months} hasBalance=${fc.hasBalance} />
    ${!fc.hasBalance && html`<span class="faint" style="font-size:12px">העמודות מראות כמה יישאר מכל חודש. אחרי שתעדכנו יתרה בעו״ש במסך הבית, הן יראו כמה יישאר בחשבון.</span>`}
    <b style="font-size:15px">חודש אחרי חודש</b>
    <div class="list">
      ${fc.months.map((m) => {
        const isOpen = open === m.index;
        const value = fc.hasBalance ? m.end : m.net;
        const badge = value < 0 ? ['נגמר במינוס', 'var(--danger)'] : ['בסדר', 'var(--income)'];
        return html`<div class="fc-month" key=${m.index}>
          <button type="button" class="row" aria-expanded=${String(isOpen)} onClick=${() => setOpen(isOpen ? null : m.index)}>
            <span class="row-main"><b>${m.name}</b><span>${fc.hasBalance ? 'בסוף החודש יישאר ' + signedMoney(m.end) : 'יישאר מהחודש ' + signedMoney(m.net)}</span></span>
            <span class="badge" style=${'--tone:' + badge[1]}>${badge[0]}</span>
          </button>
          ${isOpen && html`<div class="fc-lines rise">
            ${m.lines.map((l) => html`<div><span>${l.label}</span><b class=${'num' + (l.amount > 0 ? ' income' : '')}>${signedMoney(l.amount)}</b></div>`)}
          </div>`}
        </div>`;
      })}
    </div>
    <${WhatIf} months=${fc.months} scenarios=${scenarios} onChange=${setScenarios} result=${base ? { now: fc, before: base } : null} />
    <span class="faint" style="font-size:12px;line-height:1.55">התחזית בנויה מ-3 החודשים האחרונים, התשלומים הקבועים, תשלומים שנתיים, תשלומים בפריסה, חגים ומה שתכננתם. היא הערכה ומתעדכנת עם כל תנועה.</span>
  </div>`;
}
