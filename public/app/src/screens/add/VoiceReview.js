import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { reviewValid } from '../../domain/voice.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// What was heard, as cards to check before anything is saved: each one can be
// edited (expense/income, amount, what, category, date) or removed. Only
// "להוסיף" saves; "ביטול" goes back without saving.
export function VoiceReview({ items, unclear = [], categories, busy, onChange, onSave, onCancel, onMore }) {
  const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remove = (i) => onChange(items.filter((_, j) => j !== i));
  const ok = items.length > 0 && items.every(reviewValid);
  const total = items.reduce((s, it) => s + (it.type === 'income' ? 1 : -1) * toNumber(it.amount), 0);

  return html`<div class="stack review" style="gap:12px">
    <div><b style="font-size:16px">${items.length === 1 ? 'זה מה ששמעתי' : 'שמעתי ' + items.length + ' תנועות'}</b>
      <div class="muted" style="font-size:13px">בדקו, תקנו אם צריך, ולחצו "להוסיף". שום דבר לא נשמר לפני כן.</div></div>
    ${items.map((it, i) => {
      const kind = it.type === 'income' ? 'income' : 'expense';
      const roots = categories.filter((c) => !c.parent_id && (c.kind === 'income') === (kind === 'income'));
      return html`<div class=${'card review-item ' + kind} key=${it.key}>
        <div class="review-top">
          <div class="seg seg-sm" role="group" aria-label="סוג">
            <button type="button" aria-pressed=${String(kind === 'expense')} onClick=${() => set(i, { type: 'expense', catId: '' })}>הוצאה</button>
            <button type="button" aria-pressed=${String(kind === 'income')} onClick=${() => set(i, { type: 'income', catId: '' })}>הכנסה</button>
          </div>
          <button type="button" class="icon-btn" style="width:34px;height:34px" aria-label=${'להסיר: ' + it.description} onClick=${() => remove(i)}>✕</button>
        </div>
        <div class="review-row">
          <label class="field" style="flex:2"><span>מה</span><input class="input" value=${it.description} maxlength="80" onInput=${(e) => set(i, { description: e.target.value })} /></label>
          <label class="field" style="flex:1"><span>סכום (₪)</span><input class="input num" inputmode="decimal" value=${String(it.amount)} onInput=${(e) => set(i, { amount: toNumber(e.target.value) })} /></label>
        </div>
        <div class="review-row">
          <label class="field" style="flex:2"><span>קטגוריה</span>
            <select class="input" value=${it.catId} onChange=${(e) => set(i, { catId: e.target.value })}>
              <option value="">בלי קטגוריה</option>
              ${roots.map((r) => [html`<option value=${r.id}>${r.name}</option>`, ...categories.filter((c) => c.parent_id === r.id).map((c) => html`<option value=${c.id}>— ${c.name}</option>`)])}
            </select></label>
          <label class="field" style="flex:1"><span>תאריך</span><input class="input num" type="date" value=${it.date} onInput=${(e) => set(i, { date: e.target.value })} /></label>
        </div>
      </div>`;
    })}
    ${unclear.length > 0 && html`<div class="hint" role="note">לא הבנתי: ${unclear.map((u) => '"' + u + '"').join(', ')}. אפשר להקליט שוב או להוסיף בכתב.</div>`}
    ${items.length === 0 && html`<div class="card empty"><b style="color:var(--text)">לא נשארו תנועות</b><span>אפשר להקליט שוב או לחזור.</span></div>`}
    <div class="review-actions">
      <button type="button" class="btn" disabled=${busy || !ok} onClick=${onSave}>${busy ? html`<span class="spinner" aria-label="מוסיף"></span>` : items.length === 1 ? 'להוסיף' : 'להוסיף ' + items.length + ' תנועות'}</button>
      <button type="button" class="btn btn-ghost" disabled=${busy} onClick=${onCancel}>ביטול</button>
      ${onMore && html`<button type="button" class="btn-text" disabled=${busy} onClick=${onMore}>🎙️ להקליט עוד</button>`}
      ${items.length > 1 && html`<span class="faint num" style="font-size:12px;margin-inline-start:auto">סה״כ ${total < 0 ? '−' : '+'}${money(total)}</span>`}
    </div>
  </div>`;
}
