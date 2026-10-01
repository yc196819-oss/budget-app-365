import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { money } from '../../domain/format.js';

const KINDS = {
  buy: { label: 'קנייה גדולה', icon: '🛒', amounts: [5000, 10000, 20000, 40000], text: (a) => money(a), name: (a) => 'קנייה של ' + money(a) },
  income: { label: 'שינוי בהכנסה', icon: '💼', amounts: [1500, 3500, -4000], text: (a) => (a > 0 ? '+' : '−') + money(a) + ' בחודש', name: (a) => (a > 0 ? 'הכנסה עולה ב-' : 'הכנסה יורדת ב-') + money(a) },
  cut: { label: 'חיסכון בהוצאות', icon: '🐷', amounts: [300, 600, 1000], text: (a) => money(a) + ' בחודש', name: (a) => 'חוסכים ' + money(a) + ' בחודש' }
};

// "Check a decision before making it": nothing is saved, only the bars move.
export function WhatIf({ months, scenarios, onChange, result }) {
  const [kind, setKind] = useState(null);
  const [amount, setAmount] = useState(null);
  const [month, setMonth] = useState(null);
  const ready = kind && amount !== null && month !== null;
  const check = () => {
    if (!ready) return;
    onChange([...scenarios, { kind, amount, month, name: KINDS[kind].name(amount) }]);
    setKind(null); setAmount(null); setMonth(null);
  };
  const last = months.length - 1;
  const endOf = (fc) => (fc.hasBalance ? fc.months[last].end : fc.months.reduce((s, m) => s + m.net, 0));
  return html`<div class="card stack whatif" style="gap:10px">
    <span><b>לבדוק החלטה לפני שעושים אותה</b><br /><span class="muted" style="font-size:13px">שום דבר לא נשמר. רק רואים איך זה ישפיע על העמודות.</span></span>
    <div class="chips" role="group" aria-label="סוג">
      ${Object.entries(KINDS).map(([k, d]) => html`<button type="button" class="chip" aria-pressed=${String(kind === k)} onClick=${() => { setKind(kind === k ? null : k); setAmount(null); setMonth(null); }}>${d.icon} ${d.label}</button>`)}
    </div>
    ${kind && html`<div class="stack rise" style="gap:8px">
      <b style="font-size:13px;color:var(--muted)">כמה?</b>
      <div class="chips" role="group" aria-label="כמה">${KINDS[kind].amounts.map((a) => html`<button type="button" class="chip" aria-pressed=${String(amount === a)} onClick=${() => setAmount(a)}>${KINDS[kind].text(a)}</button>`)}</div>
      <b style="font-size:13px;color:var(--muted)">${kind === 'buy' ? 'מתי?' : 'מאיזה חודש?'}</b>
      <div class="chips" role="group" aria-label="מתי">${months.map((m) => html`<button type="button" class="chip" aria-pressed=${String(month === m.index)} onClick=${() => setMonth(m.index)}>${m.short}</button>`)}</div>
      <button type="button" class="btn" disabled=${!ready} onClick=${check}>לבדוק</button>
    </div>`}
    ${result && html`<div class="stack rise" style="gap:8px">
      <div class="whatif-result">עם מה שבדקתם: ${result.now.hasBalance ? 'בסוף ' + months[last].short + ' יישאר' : 'בחצי השנה יישארו'} <b class="num">${(endOf(result.now) < 0 ? '−' : '') + money(endOf(result.now))}</b> (בלי זה: <span class="num">${(endOf(result.before) < 0 ? '−' : '') + money(endOf(result.before))}</span>).</div>
      ${scenarios.map((s, i) => html`<div class="row" style="padding:6px 0" key=${i}><span class="row-main"><b>${s.name}</b><span>${s.kind === 'buy' ? 'ב' : 'מ'}${months[s.month].short}</span></span>
        <button type="button" class="icon-btn" style="width:32px;height:32px" aria-label=${'להסיר: ' + s.name} onClick=${() => onChange(scenarios.filter((_, j) => j !== i))}>×</button></div>`)}
      <button type="button" class="btn btn-ghost" onClick=${() => onChange([])}>לנקות את הבדיקה</button>
    </div>`}
  </div>`;
}
