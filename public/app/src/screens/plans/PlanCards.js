import { html } from '../../lib/html.js';
import { nextHoliday, holidayGoalName, lastHolidayExtra, checkinDue, quarterOf } from '../../domain/calendar.js';
import { MONTH_NAMES } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { readLocal } from '../../lib/storage.js';

export const checkinKey = (hid) => 'checkin:' + hid;

// "A holiday is coming" and "the quarterly check-in", shown on Home and Plans.
export function PlanCards({ data, onSheet, today = new Date() }) {
  const h = nextHoliday(today);
  const planned = h && data.goals.find((g) => g.name === holidayGoalName(h));
  const extra = h && !planned ? lastHolidayExtra(h.key, h.date, data.txs) : null;
  const q = quarterOf(today);
  const due = checkinDue(today, readLocal(checkinKey(data.hid), null));
  if (!h && !due) return null;
  const when = h && (h.inDays === 0 ? 'מתחיל היום' : h.inDays === 1 ? 'מתחיל מחר' : 'מתחיל בעוד ' + h.inDays + ' ימים');
  return html`<div class="stack" style="gap:8px">
    ${h && html`<button type="button" class="card plan-card" onClick=${() => onSheet({ kind: 'holiday', holiday: h })}>
      <span class="plan-icon" aria-hidden="true">🎉</span>
      <span class="plan-main"><small>חג בפתח</small><b>${h.name} ${when}</b>
        <span>${planned ? 'תכננתם ' + money(planned.target_amount) + ' לחג, וזה כבר בתחזית של החודשים הקרובים.'
          : extra ? 'בפעם הקודמת החודש של ' + h.name + ' עלה כ-' + money(extra) + ' יותר מחודש רגיל. כדאי לתכנן מראש.'
          : 'כדאי לתכנן מראש כמה החג יעלה, כדי שהתחזית תדע.'}</span>
        <span class="plan-cta">${planned ? 'לערוך' : 'לתכנן את החג'}</span></span>
    </button>`}
    ${due && html`<button type="button" class="card plan-card" onClick=${() => onSheet({ kind: 'checkin' })}>
      <span class="plan-icon" aria-hidden="true">🗓️</span>
      <span class="plan-main"><small>בדיקה רבעונית · 30 שניות</small>
        <b>צפויות הוצאות גדולות ב${q.months.map((m) => MONTH_NAMES[m.m]).join(', ')}?</b>
        <span>למשל טיפול ברכב, מוצר לבית או אירוע משפחתי. ככה הן ייכנסו לתחזית.</span>
        <span class="plan-cta">לענות</span></span>
    </button>`}
  </div>`;
}
