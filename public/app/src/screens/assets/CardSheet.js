import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { saveRow, archiveCard } from '../../data/household.js';
import { cleanLast4, billingDayValid } from '../../domain/cards.js';
import { showToast } from '../../lib/toast.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : null; };

// A credit card: name, last 4 digits, whose it is, when it is charged, its
// limit and the account it is charged to. Never the full number or the PIN.
export function CardSheet({ card, accounts, members, userId, onClose }) {
  const [name, setName] = useState(card ? card.name : '');
  const [last4, setLast4] = useState(card ? card.last4 || '' : '');
  const [owner, setOwner] = useState(card ? card.owner_user_id || '' : userId || '');
  const [day, setDay] = useState(card ? String(card.billing_day || 10) : '10');
  const [limit, setLimit] = useState(card && card.credit_limit != null ? String(card.credit_limit) : '');
  const [account, setAccount] = useState(card ? card.bank_account_id : accounts[0] ? accounts[0].id : '');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const digits = cleanLast4(last4);
  const lim = limit.trim() === '' ? null : toNumber(limit);
  const ok = name.trim() && digits !== null && billingDayValid(day) && account && (lim === null || lim >= 0);

  const save = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try {
      await saveRow('credit_cards', {
        ...(card ? { id: card.id } : { is_active: true }),
        name: name.trim().slice(0, 40),
        last4: digits || null,
        owner_user_id: owner || null,
        billing_day: Number(day),
        credit_limit: lim === null ? null : Math.round(lim),
        bank_account_id: account
      });
      onClose();
      showToast(card ? 'הכרטיס עודכן' : 'הכרטיס נוסף');
    } catch (_err) {
      setBusy(false);
      showToast('השמירה נכשלה. נסו שוב.');
    }
  };
  const remove = async () => {
    if (!sure) { setSure(true); return; }
    try { await archiveCard(card.id); onClose(); showToast('הכרטיס הוסר'); } catch (_err) { showToast('ההסרה נכשלה. נסו שוב.'); }
  };

  if (!accounts.length) {
    return html`<${Sheet} title="כרטיס חדש" onClose=${onClose}>
      <div class="card muted" style="font-size:14px">כרטיס אשראי יורד מחשבון בנק. הוסיפו קודם חשבון ("+ חשבון"), ואז את הכרטיס.</div>
    <//>`;
  }
  const people = Object.entries(members || {});
  return html`<${Sheet} title=${card ? card.name : 'כרטיס חדש'} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <label class="field"><span>שם</span><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="למשל: ויזה כאל" maxlength="40" required /></label>
      <label class="field"><span>4 ספרות אחרונות (לא חובה)</span>
        <input class="input num" inputmode="numeric" autocomplete="off" maxlength="4" value=${last4} onInput=${(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4821" />
        ${digits === null && html`<span class="hint" style="color:var(--danger)">4 ספרות בדיוק, או להשאיר ריק</span>`}</label>
      ${people.length > 1 && html`<label class="field"><span>של מי הכרטיס</span>
        <select class="input" value=${owner} onChange=${(e) => setOwner(e.target.value)}>
          <option value="">משותף</option>
          ${people.map(([id, n]) => html`<option value=${id}>${id === userId ? 'שלי' : n || 'בן/בת הזוג'}</option>`)}
        </select></label>`}
      <label class="field"><span>יום החיוב בחודש</span><input class="input num" inputmode="numeric" value=${day} onInput=${(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        ${!billingDayValid(day) && html`<span class="hint" style="color:var(--danger)">יום בין 1 ל-28</span>`}</label>
      <label class="field"><span>מסגרת אשראי (לא חובה)</span><input class="input num" inputmode="decimal" value=${limit} onInput=${(e) => setLimit(e.target.value)} placeholder="למשל 15,000" /></label>
      ${accounts.length > 1 && html`<label class="field"><span>יורד מחשבון</span>
        <select class="input" value=${account} onChange=${(e) => setAccount(e.target.value)}>${accounts.map((a) => html`<option value=${a.id}>${a.name}</option>`)}</select></label>`}
      <span class="hint">🔒 לא שומרים כאן מספר כרטיס מלא, תוקף, CVV או קוד סודי. את הקוד הסודי עדיף לשמור במנהל הסיסמאות של הטלפון.</span>
      <button type="submit" class="btn" disabled=${busy || !ok}>${busy ? 'שומר…' : 'שמירה'}</button>
      ${card && html`<button type="button" class="btn-text" style="color:var(--danger);align-self:flex-start" onClick=${remove}>${sure ? 'כן, להסיר (ההוצאות שנרשמו בו יישארו)' : 'להסיר את הכרטיס'}</button>`}
    </form>
  <//>`;
}
