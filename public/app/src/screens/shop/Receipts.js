import { html } from '../../lib/html.js';
import { useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { Sheet } from '../../components/Sheet.js';
import { historyItems, receiptsSummary } from '../../domain/receipts.js';
import { scanReceipt, saveReceipt } from '../../data/receipts.js';
import { showToast } from '../../lib/toast.js';
import { track } from '../../lib/telemetry.js';

// "A receipt from the supermarket": photographed, read, checked by the
// family, saved. Then "what you usually buy" and the list know what this home
// buys, and the price comparison shows what they paid last time.

const fmt = (n) => '₪' + (Math.round(Number(n) * 100) / 100).toFixed(2);
const dateText = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return Number(d) + '.' + Number(m) + '.' + y.slice(2); };

function Review({ receipt, onSave, onClose, busy }) {
  const [on, setOn] = useState(() => new Set(receipt.items.map((_, i) => i)));
  const [alsoList, setAlsoList] = useState(false);
  const flip = (i) => setOn((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const picked = receipt.items.filter((_, i) => on.has(i));
  const sum = picked.reduce((s, it) => s + (Number(it.price) || 0), 0);
  return html`<${Sheet} title="מה קראנו מהקבלה" onClose=${onClose} full>
    <div class="rcpt-sheet">
      <div class="rcpt-paper" aria-label="פרטי הקבלה">
        <div class="rcpt-top"><b>${receipt.store || 'חנות לא ידועה'}</b><small>${receipt.date ? dateText(receipt.date) : 'בלי תאריך'}</small></div>
        <ul class="rcpt-lines">
          ${receipt.items.map((it, i) => html`<li key=${i} class=${on.has(i) ? '' : 'off'}>
            <label><input type="checkbox" checked=${on.has(i)} onChange=${() => flip(i)} aria-label=${'לשמור: ' + it.name} />
              <span class="rcpt-n">${it.name}${it.qty > 1 ? html` <small>×${it.qty}</small>` : ''}</span></label>
            <span class="rcpt-p num">${it.price ? fmt(it.price) : '—'}</span></li>`)}
        </ul>
        <div class="rcpt-sum"><span>${picked.length} שורות נבחרו</span><b class="num">${fmt(sum)}</b></div>
        ${receipt.total && Math.abs(receipt.total - receipt.items.reduce((s, it) => s + (Number(it.price) || 0), 0)) > 1 && html`<small class="rcpt-diff">בקבלה כתוב סה״כ ${fmt(receipt.total)}. ההפרש הוא בדרך כלל הנחות, פיקדון או שקיות.</small>`}
      </div>
      <p class="muted rcpt-why">מה שתשמרו ייכנס ל"מה שאתם קונים בדרך כלל", ובהשוואת המחירים תראו כמה שילמתם בפעם האחרונה. התמונה עצמה לא נשמרת.</p>
      <label class="rcpt-also"><input type="checkbox" checked=${alsoList} onChange=${(e) => setAlsoList(e.currentTarget.checked)} /> להוסיף את המוצרים גם לרשימה של הקנייה הבאה</label>
      <div class="rcpt-acts">
        <button type="button" class="btn" disabled=${busy || !picked.length} onClick=${() => onSave({ ...receipt, items: picked }, alsoList)}>${busy ? 'שומרים…' : 'לשמור ' + picked.length + ' מוצרים'}</button>
        <button type="button" class="btn-text" onClick=${onClose}>ביטול</button>
      </div>
    </div>
  </${Sheet}>`;
}

export function Receipts({ hid, receipts, onSaved, onAddToList }) {
  const file = useRef(null);
  const [state, setState] = useState('idle');
  const [receipt, setReceipt] = useState(null);
  const [err, setErr] = useState('');
  const sum = receiptsSummary(receipts);
  const pick = async (e) => {
    const f = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    setErr(''); setState('reading');
    track('receipt_scan');
    try {
      const r = await scanReceipt(hid, f);
      setReceipt(r); setState('review');
    } catch (ex) { setErr(ex.message || 'לא הצלחנו לקרוא את הקבלה.'); setState('idle'); }
  };
  const save = async (r, alsoList) => {
    setState('saving');
    try {
      const history = historyItems(r);
      const out = await saveReceipt(hid, r, history);
      onSaved(out, r);
      if (alsoList) await onAddToList(history.map((h) => ({ name: h.name, qty: null, aisle: h.aisle })));
      track('receipt_save');
      showToast('נשמרו ' + history.length + ' מוצרים מהקבלה' + (out.saved ? '' : '. המחירים יישמרו מהקבלה הבאה'));
      setReceipt(null); setState('idle');
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); setState('review'); }
  };
  return html`<div class="card stack rcpt-card">
    <div class="rcpt-head"><span class="rcpt-ic" aria-hidden="true"><${Icon} name="receipt" size=${20} /></span>
      <span><b>קבלות מהסופר</b><small class="muted">מצלמים קבלה, והרשימה לומדת מה אתם קונים וכמה שילמתם.</small></span></div>
    ${sum.count > 0 && html`<div class="rcpt-last"><span>${sum.count === 1 ? 'קבלה אחת' : sum.count + ' קבלות'}</span>${sum.last && html`<span class="muted">האחרונה: ${[sum.last.store, dateText(sum.last.bought_on), sum.last.total ? fmt(sum.last.total) : ''].filter(Boolean).join(' · ')}</span>`}</div>`}
    ${state === 'reading' ? html`<div class="rcpt-reading" role="status"><span class="rcpt-scan" aria-hidden="true"><i></i></span>קוראים את הקבלה… זה לוקח כמה שניות</div>`
      : html`<label class="btn btn-ghost rcpt-btn"><${Icon} name="camera" size=${18} />לצלם או לבחור קבלה<input ref=${file} type="file" accept="image/*" class="sr-only" onChange=${pick} aria-label="תמונה של קבלה" /></label>`}
    ${err && html`<span class="price-warn" role="alert">${err}</span>`}
    ${receipt && (state === 'review' || state === 'saving') && html`<${Review} receipt=${receipt} busy=${state === 'saving'} onSave=${save} onClose=${() => { setReceipt(null); setState('idle'); }} />`}
  </div>`;
}
