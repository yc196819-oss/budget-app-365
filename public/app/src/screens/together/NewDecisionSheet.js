import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Segmented } from '../../components/Segmented.js';
import { money } from '../../domain/format.js';
import { impact, needsCard, endOfMonth } from '../../domain/decisions.js';
import { createDecision } from '../../data/decisions.js';
import { showToast } from '../../lib/toast.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// "I want to buy something": what, how much, when, and why it matters. The
// partner gets it for approval; the effect on the month is shown right away.
export function NewDecisionSheet({ data, threshold, userId, onClose }) {
  const today = new Date();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState('this');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = toNumber(amount);
  const wantedBy = when === 'this' ? endOfMonth(today) : when === 'next' ? endOfMonth(today, 1) : date || null;
  const fx = n > 0 ? impact({ amount: n, wanted_by: wantedBy }, data, today) : null;
  const roots = (data.categories || []).filter((c) => !c.parent_id && c.kind !== 'income');
  const ok = title.trim() && n > 0 && (when !== 'date' || date);

  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    try {
      await createDecision({ hid: data.hid, userId, title, amount: Math.round(n), category_id: categoryId || null, wanted_by: wantedBy, note });
      onClose();
      showToast('הכרטיס נשלח לאישור');
    } catch (_err) {
      setBusy(false);
      showToast('לא נשמר. נסו שוב.');
    }
  };

  return html`<${Sheet} title="אני רוצה לקנות" onClose=${onClose}>
    <form class="stack" onSubmit=${submit}>
      <label class="field"><span>מה</span><input class="input" value=${title} maxlength="80" onInput=${(e) => setTitle(e.target.value)} placeholder="למשל: מכונת כביסה חדשה" required /></label>
      <label class="field"><span>כמה (₪)</span><input class="input num" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)} required /></label>
      ${n > 0 && !needsCard(n, threshold) && html`<span class="hint">זה מתחת ל-${money(threshold)} שסיכמתם, אפשר לקנות בלי לשאול. רוצים בכל זאת לשמוע מה בן/בת הזוג חושבים? אפשר.</span>`}
      <div class="field"><span class="field-label">מתי</span>
        <${Segmented} label="מתי" value=${when} onChange=${setWhen} options=${[{ key: 'this', label: 'החודש' }, { key: 'next', label: 'בחודש הבא' }, { key: 'date', label: 'תאריך' }]} /></div>
      ${when === 'date' && html`<label class="field"><span>עד מתי</span><input class="input num" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} required /></label>`}
      <label class="field"><span>קטגוריה (לא חובה)</span>
        <select class="input" value=${categoryId} onChange=${(e) => setCategoryId(e.target.value)}>
          <option value="">בלי</option>${roots.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select></label>
      <label class="field"><span>למה זה חשוב לי</span><textarea class="input" rows="3" maxlength="500" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="כמה מילים שיעזרו להבין"></textarea></label>
      ${fx && html`<div class=${'decision-impact' + (fx.turnsNegative || (fx.roomAfter !== null && fx.roomAfter < 0) ? ' warn' : '')}>
        ${fx.roomBefore !== null && html`<span>החודש נשארים <b class="num">${money(fx.roomBefore)}</b> ← <b class="num">${money(fx.roomAfter)}</b></span>`}
        ${fx.hasBalance && html`<span>בסוף ${fx.month} בחשבון: <b class="num">${money(fx.endBefore)}</b> ← <b class="num">${money(fx.endAfter)}</b></span>`}
        ${fx.turnsNegative && html`<b>הקנייה מכניסה את החשבון למינוס ב${fx.month}</b>`}
      </div>`}
      <button type="submit" class="btn" disabled=${busy || !ok}>${busy ? 'שולח…' : 'לשלוח לאישור'}</button>
    </form>
  <//>`;
}
