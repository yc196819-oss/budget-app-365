import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Segmented } from '../../components/Segmented.js';
import { saveRow, deleteRow } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : null; };

// A loan or a debt, in either direction. "Paid off" marks it settled (it
// stays in the history, as in the current app).
export function LoanSheet({ loan, onClose }) {
  const [direction, setDirection] = useState(loan ? loan.direction || 'iowe' : 'iowe');
  const [who, setWho] = useState(loan ? loan.counterparty || '' : '');
  const [amount, setAmount] = useState(loan ? String(loan.amount) : '');
  const [note, setNote] = useState(loan ? loan.note || '' : '');
  const [busy, setBusy] = useState(false);
  const n = toNumber(amount);

  const save = async (e, extra = {}) => {
    if (e) e.preventDefault();
    if (!who.trim() || !(n > 0)) return;
    setBusy(true);
    try {
      await saveRow('loans', {
        ...(loan ? { id: loan.id } : { loan_date: new Date().toISOString().slice(0, 10), settled: false }),
        direction, counterparty: who.trim(), amount: n, note: note.trim() || null, ...extra
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
      <label class="field"><span>כמה נשאר (₪)</span><input class="input num" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)} required /></label>
      <label class="field"><span>הערה (לא חובה)</span><input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="למשל: 1,450 בחודש עד 2029" /></label>
      <button type="submit" class="btn" disabled=${busy || !who.trim() || !(n > 0)}>${busy ? 'שומר…' : 'שמירה'}</button>
      ${loan && html`<button type="button" class="btn btn-ghost" disabled=${busy} onClick=${() => save(null, { settled: true })}>${direction === 'tome' ? 'החזירו לנו הכול' : 'נפרע במלואו'}</button>
        <button type="button" class="btn-text" style="color:var(--danger);align-self:flex-start" onClick=${remove}>למחוק</button>`}
    </form>
  <//>`;
}
