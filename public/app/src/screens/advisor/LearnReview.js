import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { KIND_LABEL, isValid } from '../../domain/learn.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? Math.round(n) : NaN; };
const shortDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const GOAL_FIELD = { target_amount: 'סכום היעד', saved_amount: 'נחסך עד עכשיו', target_date: 'תאריך יעד' };

// "What I learned from the conversation": each proposal as a card the
// person can edit or switch off. Only the switched-on, valid ones are saved.
export function LearnReview({ state, onChange, onApply, onCancel, onRetry }) {
  if (state.status === 'loading') {
    return html`<div class="card learn-loading" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>קורא את השיחה ומחפש מה כדאי לעדכן…</div>`;
  }
  if (state.status === 'error') {
    return html`<div class="card stack" role="alert"><b>${state.error}</b>
      <div class="learn-actions"><button type="button" class="btn" onClick=${onRetry}>לנסות שוב</button><button type="button" class="btn btn-ghost" onClick=${onCancel}>חזרה לשיחה</button></div></div>`;
  }
  if (state.status === 'done') {
    const { done, failed } = state.result;
    return html`<div class="card stack learn-done" role="status">
      <b>${done.length ? 'עודכנו ' + done.length + ' דברים' : 'לא עודכן כלום'}</b>
      ${done.length > 0 && html`<span class="muted" style="font-size:13px">היעדים, התקציב והתחזית כבר מחושבים לפי זה, והיועץ יזכור את זה בשיחות הבאות.</span>`}
      ${failed.length > 0 && html`<span style="color:var(--danger);font-size:13px">${failed.length} לא נשמרו. אפשר לנסות שוב.</span>`}
      <button type="button" class="btn btn-ghost" onClick=${onCancel}>חזרה לשיחה</button>
    </div>`;
  }

  const items = state.items;
  const set = (i, patch) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const chosen = items.filter((it) => it.on && isValid(it));
  if (items.length === 0) {
    return html`<div class="card stack learn-empty"><b>לא מצאתי בשיחה משהו חדש לעדכן</b>
      <span class="muted" style="font-size:13px">כשתספרו ליועץ על החלטה, יעד, שינוי בהכנסה או הוצאה מתוכננת, אציע לשמור אותם כאן.</span>
      <button type="button" class="btn btn-ghost" onClick=${onCancel}>חזרה לשיחה</button></div>`;
  }
  return html`<div class="stack learn" style="gap:10px">
    <div><b style="font-size:16px">מה למדתי מהשיחה</b><div class="muted" style="font-size:13px">אפשר לתקן כל דבר או להוריד את הסימון. רק מה שמסומן יישמר.</div></div>
    ${items.map((it, i) => html`<div class=${'card learn-item' + (it.on ? '' : ' off')} key=${it.key}>
      <label class="learn-head">
        <input type="checkbox" checked=${it.on} onChange=${(e) => set(i, { on: e.target.checked })} aria-label=${'לשמור: ' + KIND_LABEL[it.kind].label} />
        <span class="learn-kind">${KIND_LABEL[it.kind].icon} ${KIND_LABEL[it.kind].label}${it.kind === 'goal_update' ? ': ' + it.name : ''}</span>
      </label>
      <${Fields} item=${it} set=${(patch) => set(i, patch)} />
    </div>`)}
    <div class="learn-actions">
      <button type="button" class="btn" disabled=${state.status === 'saving' || chosen.length === 0} onClick=${() => onApply(chosen)}>${state.status === 'saving' ? html`<span class="spinner" aria-label="שומר"></span>` : 'לעדכן (' + chosen.length + ')'}</button>
      <button type="button" class="btn btn-ghost" disabled=${state.status === 'saving'} onClick=${onCancel}>ביטול</button>
    </div>
  </div>`;
}

function Text({ label, value, onInput, max = 120 }) {
  return html`<label class="field"><span>${label}</span><input class="input" value=${value} maxlength=${max} onInput=${(e) => onInput(e.target.value)} /></label>`;
}
function Amount({ label, value, onInput, before }) {
  return html`<label class="field"><span>${label}${before !== undefined && before !== null ? html` <small class="faint">(היום: ${money(before)})</small>` : ''}</span>
    <input class="input num" inputmode="numeric" value=${Number.isFinite(value) ? String(value) : ''} onInput=${(e) => onInput(toNumber(e.target.value))} /></label>`;
}
function DateField({ label, value, onInput, before }) {
  return html`<label class="field"><span>${label}${before ? html` <small class="faint">(היום: ${shortDate(before)})</small>` : ''}</span>
    <input class="input num" type="date" value=${value || ''} onInput=${(e) => onInput(e.target.value || null)} /></label>`;
}

function Fields({ item, set }) {
  switch (item.kind) {
    case 'memory':
      return html`<${Text} label="מה לזכור" value=${item.text} onInput=${(v) => set({ text: v })} />`;
    case 'goal':
      return html`<${Text} label="שם" value=${item.name} max=${60} onInput=${(v) => set({ name: v })} />
        <div class="learn-row"><${Amount} label="סכום (₪)" value=${item.target_amount} onInput=${(v) => set({ target_amount: v })} />
        <${DateField} label="עד מתי" value=${item.target_date} onInput=${(v) => set({ target_date: v })} /></div>
        ${item.saved_amount > 0 && html`<${Amount} label="כבר נחסך (₪)" value=${item.saved_amount} onInput=${(v) => set({ saved_amount: v })} />`}`;
    case 'goal_update':
      return html`${Object.keys(item.set).map((f) => (f === 'target_date'
        ? html`<${DateField} key=${f} label=${GOAL_FIELD[f]} value=${item.set[f]} before=${item.before[f]} onInput=${(v) => set({ set: { ...item.set, [f]: v } })} />`
        : html`<${Amount} key=${f} label=${GOAL_FIELD[f] + ' (₪)'} value=${item.set[f]} before=${Number(item.before[f]) || 0} onInput=${(v) => set({ set: { ...item.set, [f]: v } })} />`))}`;
    case 'budget':
      return html`<${Amount} label=${'תקציב חודשי ל' + item.category + ' (₪)'} value=${item.amount} before=${item.before} onInput=${(v) => set({ amount: v })} />`;
    case 'balance':
      return html`<${Amount} label=${'יתרה ב' + item.account + ' (₪)'} value=${item.balance} before=${item.before} onInput=${(v) => set({ balance: v })} />`;
    case 'loan':
      return html`<div class="learn-row"><${Text} label=${item.direction === 'tome' ? 'מי חייב לנו' : 'למי אנחנו חייבים'} value=${item.counterparty} max=${60} onInput=${(v) => set({ counterparty: v })} />
        <${Amount} label="סכום (₪)" value=${item.amount} onInput=${(v) => set({ amount: v })} /></div>`;
    case 'installment':
      return html`<${Text} label="מה נקנה" value=${item.description} max=${60} onInput=${(v) => set({ description: v })} />
        <div class="learn-row"><${Amount} label="סכום כולל (₪)" value=${item.total_amount} onInput=${(v) => set({ total_amount: v })} />
        <${Amount} label="מספר תשלומים" value=${item.payments_count} onInput=${(v) => set({ payments_count: v })} /></div>`;
    case 'income':
      return html`<${Amount} label="הכנסה חודשית נטו של משק הבית (₪)" value=${item.amount} before=${item.before} onInput=${(v) => set({ amount: v })} />`;
    default:
      return null;
  }
}
