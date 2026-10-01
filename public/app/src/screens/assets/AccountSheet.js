import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { saveRow } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : null; };

// A bank account: its name and the balance typed in from the bank's app.
export function AccountSheet({ account, onClose }) {
  const [name, setName] = useState(account ? account.name : '');
  const [bank, setBank] = useState(account ? account.bank_name || '' : '');
  const [balance, setBalance] = useState(account && account.balance != null ? String(account.balance) : '');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    const b = balance.trim() === '' ? null : toNumber(balance);
    if (!name.trim() || (balance.trim() !== '' && b === null)) return;
    setBusy(true);
    const balanceChanged = !account || b !== (account.balance == null ? null : Number(account.balance));
    try {
      await saveRow('bank_accounts', {
        ...(account ? { id: account.id } : {}),
        name: name.trim(),
        bank_name: bank.trim() || null,
        ...(balanceChanged ? { balance: b, balance_updated_at: b === null ? null : new Date().toISOString() } : {})
      });
      onClose();
      showToast(account ? 'החשבון עודכן' : 'החשבון נוסף');
    } catch (_err) {
      setBusy(false);
      showToast('השמירה נכשלה. נסו שוב.');
    }
  };
  return html`<${Sheet} title=${account ? account.name : 'חשבון חדש'} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <label class="field"><span>שם</span><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="למשל: עו״ש משותף" required /></label>
      <label class="field"><span>בנק (לא חובה)</span><input class="input" value=${bank} onInput=${(e) => setBank(e.target.value)} placeholder="למשל: לאומי" /></label>
      <label class="field"><span>יתרה עכשיו (מהאפליקציה של הבנק)</span><input class="input num" inputmode="decimal" value=${balance} onInput=${(e) => setBalance(e.target.value)} placeholder="למשל 8,400" /></label>
      <button type="submit" class="btn" disabled=${busy || !name.trim()}>${busy ? 'שומר…' : 'שמירה'}</button>
    </form>
  <//>`;
}
