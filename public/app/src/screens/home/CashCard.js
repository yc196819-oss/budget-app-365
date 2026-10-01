import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { money } from '../../domain/format.js';
import { Icon } from '../../components/Icon.js';
import { setBalance } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// Free money in the bank: the balance (typed in by hand, shared by the
// household) minus card charges that did not go out yet.
export function CashCard({ cash, accounts }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  if (!accounts.length) return null;

  const save = async (e) => {
    e.preventDefault();
    const n = Number(String(value).replace(/[,₪\s]/g, ''));
    if (!Number.isFinite(n) || value === '') return;
    setBusy(true);
    try {
      await setBalance(accounts[0].id, n);
      setEditing(false);
      setValue('');
    } catch (_err) {
      showToast('העדכון נכשל. נסו שוב.');
    }
    setBusy(false);
  };

  if (editing || !cash.known) {
    return html`<form class="card cash" onSubmit=${save}>
      <span class="cash-head"><span class="cash-icon"><${Icon} name="assets" size=${20} /></span><b>כמה יש עכשיו בעו״ש?</b></span>
      <span class="muted" style="font-size:13px;line-height:1.5">מהאפליקציה של הבנק. נוריד ממנו את האשראי שעוד לא ירד ונראה כמה באמת פנוי.</span>
      <span style="display:flex;gap:8px">
        <input class="input num" inputmode="decimal" aria-label="יתרה בעו״ש" placeholder="למשל 8,400" value=${value} onInput=${(e) => setValue(e.target.value)} style="flex:1" />
        <button type="submit" class="btn" disabled=${busy || !value}>שמירה</button>
      </span>
    </form>`;
  }
  const date = cash.updatedAt ? new Date(cash.updatedAt) : null;
  return html`<div class="card cash">
    <span class="cash-head">
      <span class="cash-icon"><${Icon} name="assets" size=${20} /></span>
      <b style="flex:1">כסף פנוי בחשבון</b>
      <b class="num" style=${'font-size:22px;color:' + (cash.free < 0 ? 'var(--danger)' : 'var(--text)')}>${(cash.free < 0 ? '−' : '') + money(cash.free)}</b>
    </span>
    <span class="muted" style="font-size:13px;line-height:1.5">עו״ש ${money(cash.balance)}${cash.pending > 0 ? ' פחות ' + money(cash.pending) + ' באשראי שעוד לא ירד (הערכה)' : ''}</span>
    <button type="button" class="btn-text" style="align-self:flex-start;padding:0;min-height:28px" onClick=${() => setEditing(true)}>
      ${date ? 'עודכן ב-' + date.getDate() + '.' + (date.getMonth() + 1) + ' · ' : ''}לעדכן יתרה</button>
  </div>`;
}
