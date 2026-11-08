import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { monthlyFor, emergencyTarget, dateIn } from '../../domain/goals.js';
import { saveGoal } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

const KINDS = [
  { key: 'emergency', icon: '🛟', name: 'קרן חירום' },
  { key: 'trip', icon: '✈️', name: 'חופשה' },
  { key: 'car', icon: '🚗', name: 'רכב' },
  { key: 'event', icon: '🎉', name: 'חג או אירוע' },
  { key: 'home', icon: '🏠', name: 'דירה' },
  { key: 'other', icon: '🎯', name: '' }
];
const WHEN = [{ months: 6, label: 'חצי שנה' }, { months: 12, label: 'שנה' }, { months: 24, label: 'שנתיים' }];
const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// A new goal: what, how much, by when, and what that means every month,
// checked against what this household has had left at the end of a month.
export function GoalSheet({ totalAvg = 0, left = null, onClose }) {
  const [kind, setKind] = useState(KINDS[0]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [months, setMonths] = useState(12);
  const [date, setDate] = useState('');
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = new Date();
  const target = toNumber(amount);
  const when = date || dateIn(months, today);
  const monthly = monthlyFor({ target, date: when, today });
  const emergency = kind.key === 'emergency' ? emergencyTarget(totalAvg) : 0;
  const title = kind.key === 'other' ? name.trim() : kind.name;
  const save = async (e) => {
    e.preventDefault();
    if (busy || !target || !title) return;
    setBusy(true);
    try {
      await saveGoal({ name: title, icon: kind.icon, target_amount: Math.round(target), saved_amount: 0, target_date: when });
      showToast('היעד נשמר: ' + title + (monthly ? ', ' + money(monthly) + ' בחודש' : ''));
      onClose();
    } catch (_e) { showToast('השמירה נכשלה. נסו שוב.'); setBusy(false); }
  };
  return html`<${Sheet} title="יעד חדש" onClose=${onClose}>
    <form class="stack" style="gap:14px" onSubmit=${save}>
      <div class="chips" role="group" aria-label="סוג היעד">
        ${KINDS.map((k) => html`<button type="button" class="chip" aria-pressed=${String(kind.key === k.key)} onClick=${() => setKind(k)}>${k.icon} ${k.name || 'אחר'}</button>`)}
      </div>
      ${kind.key === 'other' && html`<label class="stack" style="gap:6px"><b style="font-size:14px">שם היעד</b>
        <input class="input" value=${name} maxLength="60" placeholder="למשל: מחשב חדש" onInput=${(e) => setName(e.target.value)} /></label>`}
      <label class="stack" style="gap:6px"><b style="font-size:14px">כמה צריך?</b>
        <input class="input num" inputmode="numeric" aria-label="סכום היעד" placeholder="למשל 20,000" value=${amount} onInput=${(e) => setAmount(e.target.value)} /></label>
      ${emergency > 0 && html`<div class="card suggest-card" style="font-size:14px;line-height:1.55">קרן חירום מומלצת: 3 חודשי הוצאות. אצלכם זה בערך <b class="num">${money(emergency)}</b>, לפי הממוצע שלכם. אפשר להתחיל ביעד קטן יותר.
        <button type="button" class="btn-text" style="display:block;margin-top:4px" onClick=${() => setAmount(String(emergency))}>להשתמש בסכום הזה</button></div>`}
      <div class="stack" style="gap:6px"><b style="font-size:14px">עד מתי?</b>
        <div class="chips" role="group" aria-label="עד מתי">
          ${WHEN.map((w) => html`<button type="button" class="chip" aria-pressed=${String(!custom && months === w.months)} onClick=${() => { setDate(''); setCustom(false); setMonths(w.months); }}>${w.label}</button>`)}
          <button type="button" class="chip" aria-pressed=${String(custom)} onClick=${() => setCustom(true)}>תאריך אחר</button>
        </div>
        ${custom && html`<input class="input" type="month" aria-label="חודש היעד" value=${date ? date.slice(0, 7) : dateIn(months, today).slice(0, 7)} min=${dateIn(1, today).slice(0, 7)} onInput=${(e) => setDate(e.target.value ? e.target.value + '-01' : '')} />`}
      </div>
      ${monthly > 0 && html`<div class="card stack goal-plan" style="gap:4px">
        <b>צריך להפריש ${money(monthly)} בחודש</b>
        ${left !== null && html`<span class="muted" style="font-size:14px;line-height:1.55">${left <= 0
          ? 'בחודשים האחרונים לא נשאר לכם כסף בסוף החודש, אז כדאי למצוא קודם איפה לחסוך (היועץ יכול לעזור).'
          : monthly <= left ? 'בחודשים האחרונים נשארו לכם בממוצע ' + money(left) + ' בסוף החודש, אז זה אפשרי.'
            : 'זה יותר ממה שנשאר לכם בממוצע בסוף החודש (' + money(left) + '). אפשר להאריך את הזמן או להקטין את הסכום.'}</span>`}
      </div>`}
      <button type="submit" class="btn" disabled=${busy || !target || !title}>${busy ? 'שומר…' : 'לשמור את היעד'}</button>
    </form>
  <//>`;
}
