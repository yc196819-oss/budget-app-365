import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { CHECKIN_KINDS, quarterOf } from '../../domain/calendar.js';
import { MONTH_NAMES, isoDate } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { saveGoal } from '../../data/household.js';
import { writeLocal } from '../../lib/storage.js';
import { showToast } from '../../lib/toast.js';
import { checkinKey } from './PlanCards.js';

const AMOUNTS = [500, 1000, 2500, 5000];

// Big expenses expected this quarter. Each one is saved as a goal with a date
// (the middle of its month), so the forecast counts it.
export function CheckinSheet({ data, onClose, today = new Date() }) {
  const q = quarterOf(today);
  const [list, setList] = useState([]);
  const [kind, setKind] = useState(null);
  const [amount, setAmount] = useState(null);
  const [month, setMonth] = useState(null);
  const [busy, setBusy] = useState(false);
  const ready = kind && amount && month !== null;

  const add = () => {
    if (!ready) return;
    setList([...list, { kind, amount, month }]);
    setKind(null); setAmount(null); setMonth(null);
  };

  const finish = async () => {
    setBusy(true);
    try {
      for (const it of list) {
        const k = CHECKIN_KINDS.find((x) => x.key === it.kind);
        const m = q.months[it.month];
        await saveGoal({ name: k.label + ' · ' + MONTH_NAMES[m.m], icon: k.icon, target_amount: it.amount, target_date: isoDate(new Date(m.y, m.m, 15)), plan_items: [] });
      }
      writeLocal(checkinKey(data.hid), q.id);
      onClose();
      showToast(list.length ? 'נכנסו לתחזית ' + list.length + ' הוצאות צפויות' : 'מעולה, אין הוצאות גדולות ברבעון הזה');
    } catch (_err) {
      setBusy(false);
      showToast('השמירה נכשלה. נסו שוב.');
    }
  };

  return html`<${Sheet} title="בדיקה רבעונית" onClose=${onClose}>
    <span class="muted" style="font-size:14px;line-height:1.5">צפויות הוצאות גדולות ב${q.months.map((m) => MONTH_NAMES[m.m]).join(', ')}? בחרו מה, כמה ומתי.</span>
    <div class="chips" role="group" aria-label="מה">
      ${CHECKIN_KINDS.map((k) => html`<button type="button" class="chip" aria-pressed=${String(kind === k.key)} onClick=${() => setKind(kind === k.key ? null : k.key)}>${k.icon} ${k.label}</button>`)}
    </div>
    ${kind && html`<div class="stack rise" style="gap:8px">
      <b style="font-size:13px;color:var(--muted)">כמה, בערך?</b>
      <div class="chips" role="group" aria-label="כמה">${AMOUNTS.map((a) => html`<button type="button" class="chip" aria-pressed=${String(amount === a)} onClick=${() => setAmount(a)}>${money(a)}</button>`)}</div>
      <b style="font-size:13px;color:var(--muted)">מתי?</b>
      <div class="chips" role="group" aria-label="מתי">${q.months.map((m, i) => html`<button type="button" class="chip" aria-pressed=${String(month === i)} onClick=${() => setMonth(i)}>${MONTH_NAMES[m.m]}</button>`)}</div>
      <button type="button" class="btn btn-ghost" disabled=${!ready} onClick=${add}>להוסיף לרשימה</button>
    </div>`}
    ${list.length > 0 && html`<div class="list">${list.map((it, i) => {
      const k = CHECKIN_KINDS.find((x) => x.key === it.kind);
      return html`<div class="row" key=${i}><span aria-hidden="true">${k.icon}</span><span class="row-main"><b>${k.label}</b><span>${MONTH_NAMES[q.months[it.month].m]}</span></span>
        <b class="num">${money(it.amount)}</b>
        <button type="button" class="icon-btn" style="width:32px;height:32px" aria-label=${'להסיר את ' + k.label} onClick=${() => setList(list.filter((_, j) => j !== i))}>×</button></div>`;
    })}</div>`}
    <button type="button" class="btn" disabled=${busy} onClick=${finish}>${busy ? 'שומר…' : list.length ? 'לשמור ' + list.length + ' הוצאות לתחזית' : 'אין הוצאות גדולות ברבעון'}</button>
  <//>`;
}
