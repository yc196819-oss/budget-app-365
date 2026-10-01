import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { saveAgreement } from '../../data/decisions.js';
import { showToast } from '../../lib/toast.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : null; };

// The couple's agreement: from what amount a purchase is decided together,
// and how much each one spends a month without asking.
export function AgreementSheet({ hid, threshold, allowance, onClose }) {
  const [t, setT] = useState(String(threshold));
  const [a, setA] = useState(allowance ? String(allowance) : '');
  const [busy, setBusy] = useState(false);
  const tn = toNumber(t);
  const an = a.trim() ? toNumber(a) : null;
  const ok = tn !== null && tn >= 0 && (a.trim() === '' || (an !== null && an >= 0));

  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    try { await saveAgreement(hid, { threshold: tn, allowance: an }); onClose(); showToast('ההסכם עודכן'); } catch (_err) { setBusy(false); showToast('לא נשמר. נסו שוב.'); }
  };

  return html`<${Sheet} title="ההסכם שלנו" onClose=${onClose}>
    <form class="stack" onSubmit=${submit}>
      <span class="muted" style="font-size:14px;line-height:1.5">כדאי לקבוע את זה ביחד. סף נמוך מדי מרגיש כמו פיקוח, גבוה מדי מפספס דברים חשובים.</span>
      <label class="field"><span>מחליטים ביחד על כל קנייה מעל (₪)</span><input class="input num" inputmode="numeric" value=${t} onInput=${(e) => setT(e.target.value)} required /></label>
      <label class="field"><span>דמי כיס: כל אחד מוציא בחודש בלי לשאול (₪, לא חובה)</span><input class="input num" inputmode="numeric" value=${a} onInput=${(e) => setA(e.target.value)} placeholder="למשל: 400" /></label>
      <button type="submit" class="btn" disabled=${busy || !ok}>${busy ? 'שומר…' : 'שמירה'}</button>
    </form>
  <//>`;
}
