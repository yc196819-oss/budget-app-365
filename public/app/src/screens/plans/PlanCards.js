import { html } from '../../lib/html.js';
import { Icon } from '../../components/Icon.js';
import { nextHoliday, holidayGoalName, lastHolidayExtra, checkinDue, quarterOf } from '../../domain/calendar.js';
import { MONTH_NAMES } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { useState } from 'preact/hooks';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { showToast } from '../../lib/toast.js';

export const checkinKey = (hid) => 'checkin:' + hid;
// A holiday card closed with ✕: this holiday only (the next one shows again).
export const holidayHideKey = (hid, h) => 'holiday:hide:' + hid + ':' + h.key + ':' + String(h.date instanceof Date ? h.date.getFullYear() : String(h.date).slice(0, 4));

// "A holiday is coming" and "the quarterly check-in", shown on Home and Plans.
export function PlanCards({ data, onSheet, today = new Date() }) {
  const [, setHidden] = useState(0);
  const next = nextHoliday(today);
  const h = next && readLocal(holidayHideKey(data.hid, next), '') !== '1' ? next : null;
  const hide = (e) => {
    e.stopPropagation();
    writeLocal(holidayHideKey(data.hid, next), '1');
    setHidden((v) => v + 1);
    showToast('הוסתר. יופיע שוב רק בחג הבא.', { undo: () => { writeLocal(holidayHideKey(data.hid, next), ''); setHidden((v) => v + 1); } });
  };
  const planned = h && data.goals.find((g) => g.name === holidayGoalName(h));
  const extra = h && !planned ? lastHolidayExtra(h.key, h.date, data.txs) : null;
  const q = quarterOf(today);
  const due = checkinDue(today, readLocal(checkinKey(data.hid), null));
  if (!h && !due) return null;
  const when = h && (h.inDays === 0 ? 'מתחיל היום' : h.inDays === 1 ? 'מתחיל מחר' : 'מתחיל בעוד ' + h.inDays + ' ימים');
  return html`<div class="stack" style="gap:8px">
    ${h && html`<div class="plan-wrap"><button type="button" class="card plan-card" onClick=${() => onSheet({ kind: 'holiday', holiday: h })}>
      <span class="plan-icon" aria-hidden="true"><${Icon} name="plans" size=${22} /></span>
      <span class="plan-main"><small>חג בפתח</small><b>${h.name} ${when}</b>
        <span>${planned ? 'תכננתם ' + money(planned.target_amount) + ' לחג, וזה כבר בתחזית של החודשים הקרובים.'
          : extra ? 'בפעם הקודמת החודש של ' + h.name + ' עלה כ-' + money(extra) + ' יותר מחודש רגיל. כדאי לתכנן מראש.'
          : 'כדאי לתכנן מראש כמה החג יעלה, כדי שהתחזית תדע.'}</span>
        <span class="plan-cta">${planned ? 'לערוך' : 'לתכנן את החג'}</span></span>
    </button><button type="button" class="icon-btn plan-close" aria-label=${'להסתיר את ' + h.name} onClick=${hide}><${Icon} name="x" size=${16} stroke=${2.2} /></button></div>`}
    ${due && html`<button type="button" class="card plan-card" onClick=${() => onSheet({ kind: 'checkin' })}>
      <span class="plan-icon" aria-hidden="true"><${Icon} name="calendar" size=${22} /></span>
      <span class="plan-main"><small>בדיקה רבעונית · 30 שניות</small>
        <b>צפויות הוצאות גדולות ב${q.months.map((m) => MONTH_NAMES[m.m]).join(', ')}?</b>
        <span>למשל טיפול ברכב, מוצר לבית או אירוע משפחתי. ככה הן ייכנסו לתחזית.</span>
        <span class="plan-cta">לענות</span></span>
    </button>`}
  </div>`;
}
