import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Segmented } from '../../components/Segmented.js';
import { saveRow, deleteRow } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';
import { money } from '../../domain/format.js';
import { isoDate } from '../../domain/money.js';
import { loanPlan } from '../../domain/assets.js';

const monthYear = (d) => String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
const dayMonth = (d) => d.getDate() + '.' + (d.getMonth() + 1);
// The first payment, by default a month from today.
const nextMonth = (today) => isoDate(new Date(today.getFullYear(), today.getMonth() + 1, Math.min(today.getDate(), 28)));
const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : null; };

// A loan or a debt, in either direction. "Paid off" marks it settled (it
// stays in the history, as in the current app).
export function LoanSheet({ loan, onClose, today = new Date() }) {
  const [direction, setDirection] = useState(loan ? loan.direction || 'iowe' : 'iowe');
  const [who, setWho] = useState(loan ? loan.counterparty || '' : '');
  const [amount, setAmount] = useState(loan ? String(loan.amount) : '');
  const [note, setNote] = useState(loan ? loan.note || '' : '');
  const [busy, setBusy] = useState(false);
  // Paid back month by month: by a number of payments or a sum each month.
  const [monthly, setMonthly] = useState(loan && Number(loan.monthly_amount) > 0 ? 'monthly' : 'once');
  const [by, setBy] = useState('sum');
  const [each, setEach] = useState(loan && Number(loan.monthly_amount) > 0 ? String(loan.monthly_amount) : '');
  const [count, setCount] = useState('');
  const [first, setFirst] = useState(loan && loan.first_payment ? loan.first_payment : nextMonth(today));
  const n = toNumber(amount);
  const per = monthly !== 'monthly' ? null : by === 'count' ? (toNumber(count) > 0 && n > 0 ? Math.round((n / Math.round(toNumber(count))) * 100) / 100 : null) : toNumber(each);
  const planOk = monthly !== 'monthly' || (per > 0 && /^\d{4}-\d{2}-\d{2}$/.test(first));
  const preview = monthly === 'monthly' && planOk && n > 0 ? loanPlan({ amount: n, monthly_amount: per, first_payment: first }, today) : null;

  const save = async (e, extra = {}) => {
    if (e) e.preventDefault();
    if (!who.trim() || !(n > 0) || !planOk) return;
    setBusy(true);
    try {
      await saveRow('loans', {
        ...(loan ? { id: loan.id } : { loan_date: new Date().toISOString().slice(0, 10), settled: false }),
        direction, counterparty: who.trim(), amount: n, note: note.trim() || null,
        monthly_amount: monthly === 'monthly' ? per : null, first_payment: monthly === 'monthly' ? first : null, ...extra
      });
      onClose();
      showToast(extra.settled ? 'סומן כנפרע' : loan ? 'עודכן' : 'נוסף');
    } catch (_err) {
      setBusy(false);
      showToast('השמירה נכשלה. נסו שוב.');
    }
  };
  const remove = async () => {
    try { await deleteRow('loans', loan.id); onClose(); showToast('נמחק'); } catch (_err) { showToast('המחיקה נכשלה. נסו שוב.'); }
  };

  return html`<${Sheet} title=${loan ? loan.counterparty || 'הלוואה' : 'הלוואה או חוב'} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <${Segmented} label="כיוון" value=${direction} onChange=${setDirection} options=${[{ key: 'iowe', label: 'אנחנו חייבים' }, { key: 'tome', label: 'חייבים לנו' }]} />
      <label class="field"><span>${direction === 'tome' ? 'מי חייב' : 'למי'}</span><input class="input" value=${who} onInput=${(e) => setWho(e.target.value)} placeholder=${direction === 'tome' ? 'למשל: אחי' : 'למשל: הלוואת רכב בבנק'} required /></label>
      <${Segmented} label="איך מחזירים" value=${monthly} onChange=${setMonthly} options=${[{ key: 'once', label: 'בבת אחת / לא ידוע' }, { key: 'monthly', label: 'כל חודש' }]} />
      <label class="field"><span>${monthly === 'monthly' ? 'סכום החוב כשמתחילים התשלומים (₪)' : 'כמה נשאר (₪)'}</span><input class="input num" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)} required /></label>
      ${monthly === 'monthly' && html`<div class="stack loan-plan">
        <${Segmented} label="לפי" value=${by} onChange=${setBy} options=${[{ key: 'sum', label: 'סכום בחודש' }, { key: 'count', label: 'מספר תשלומים' }]} />
        ${by === 'sum'
          ? html`<label class="field"><span>כמה בכל חודש (₪)</span><input class="input num" inputmode="decimal" value=${each} onInput=${(e) => setEach(e.target.value)} placeholder="למשל: 500" /></label>`
          : html`<label class="field"><span>כמה תשלומים</span><input class="input num" inputmode="numeric" value=${count} onInput=${(e) => setCount(e.target.value)} placeholder="למשל: 10" /></label>`}
        <label class="field"><span>התשלום הראשון</span><input class="input" type="date" value=${first} onInput=${(e) => setFirst(e.target.value)} /></label>
        ${preview && html`<div class="loan-preview" role="status">
          <b>${preview.count === 1 ? 'תשלום אחד' : preview.count + ' תשלומים'} של ${money(preview.monthly)}${preview.count > 1 && preview.monthly * preview.count !== n ? ' (האחרון ' + money(n - preview.monthly * (preview.count - 1)) + ')' : ''}</b>
          <span>${preview.count > 1 ? 'מ-' + monthYear(new Date(first + 'T00:00')) + ' עד ' + monthYear(preview.last) : 'ב-' + monthYear(preview.last)}. ${direction === 'tome' ? 'כל חודש החוב יורד, והתשלום נספר בתחזית כהכנסה צפויה.' : 'כל חודש החוב יורד בסכום הזה.'}</span>
          ${preview.paid > 0 && html`<span>כבר שולמו ${preview.paid}, נשאר עכשיו ${money(preview.left)}${preview.next ? ', הבא ב-' + dayMonth(preview.next) : ''}.</span>`}
        </div>`}
      </div>`}
      <label class="field"><span>הערה (לא חובה)</span><input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="למשל: 1,450 בחודש עד 2029" /></label>
      <button type="submit" class="btn" disabled=${busy || !who.trim() || !(n > 0) || !planOk}>${busy ? 'שומר…' : 'שמירה'}</button>
      ${loan && html`<button type="button" class="btn btn-ghost" disabled=${busy} onClick=${() => save(null, { settled: true })}>${direction === 'tome' ? 'החזירו לנו הכול' : 'נפרע במלואו'}</button>
        <button type="button" class="btn-text" style="color:var(--danger);align-self:flex-start" onClick=${remove}>למחוק</button>`}
    </form>
  <//>`;
}
