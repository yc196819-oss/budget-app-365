import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { money } from '../../domain/format.js';
import { Icon } from '../../components/Icon.js';
import { setBalance, saveRow, deleteRow } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// Free money in the bank: the balance (typed in by hand, shared by the
// household) minus card charges that did not go out yet.
export function CashCard({ cash, accounts, cards = [], unassigned = [] }) {
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
    ${unassigned.map((p) => html`<${Unassigned} key=${p.id} charge=${p} cards=${cards} accounts=${accounts} />`)}
  </div>`;
}

// A card charge told to the advisor without saying which card: counted in
// the free money already; here it is attached to a card, to a new card, or
// removed (it went out, or was a mistake).
function Unassigned({ charge, cards, accounts }) {
  const [pick, setPick] = useState(cards.length === 1 ? cards[0].id : '');
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); showToast(ok); } catch (_err) { showToast('לא נשמר. נסו שוב.'); }
    setBusy(false);
  };
  const attach = () => run(() => saveRow('card_pending', { id: charge.id, card_id: pick }), 'החיוב צורף לכרטיס.');
  const newCard = () => run(async () => {
    const card = await saveRow('credit_cards', { name: charge.label || 'כרטיס חדש', bank_account_id: accounts[0].id, billing_day: 10, is_active: true });
    await saveRow('card_pending', { id: charge.id, card_id: card.id });
  }, 'נפתח כרטיס חדש והחיוב צורף אליו. אפשר לשנות את פרטיו בנכסים.');
  const remove = () => run(() => deleteRow('card_pending', charge.id), 'החיוב הוסר.');
  return html`<div class="cash-unassigned" role="group" aria-label="חיוב שלא ידוע לאיזה כרטיס">
    <span><b class="num">${money(charge.amount)}</b> באשראי שעוד לא ירד${charge.label ? ' (' + charge.label + ')' : ''}: לא ידוע לאיזה כרטיס. הוא כבר נספר למעלה.</span>
    <span class="cash-unassigned-row">
      ${cards.length > 0 && html`<select class="input" aria-label="לאיזה כרטיס" value=${pick} onChange=${(e) => setPick(e.target.value)}>
        <option value="">לבחור כרטיס…</option>
        ${cards.map((c) => html`<option value=${c.id}>${c.name}${c.last4 ? ' ' + c.last4 : ''}</option>`)}
      </select>`}
      ${cards.length > 0 && html`<button type="button" class="btn" disabled=${busy || !pick} onClick=${attach}>לצרף</button>`}
    </span>
    <span class="cash-unassigned-row">
      <button type="button" class="btn-text" disabled=${busy} onClick=${newCard}>זה כרטיס חדש</button>
      <button type="button" class="btn-text" disabled=${busy} onClick=${remove}>להסיר</button>
    </span>
  </div>`;
}
