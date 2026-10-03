import { html } from '../../lib/html.js';
import { useEffect } from 'preact/hooks';
import { money } from '../../domain/format.js';
import { reviewValid, inShekels, CURRENCIES } from '../../domain/voice.js';
import { getRate } from '../../data/fx.js';

// Converted amounts keep their agorot (₪184.40).
const shekels = (n) => '₪' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// What was heard, as cards to check before anything is saved: each one can be
// edited (expense/income, amount, what, category, date) or removed. Only
// "להוסיף" saves; "ביטול" goes back without saving.
export function VoiceReview({ items, unclear = [], categories, busy, onChange, onSave, onCancel, onMore }) {
  const set = (i, patch) => { const key = items[i].key; onChange((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it))); };
  // Foreign amounts: fetch the rate of each card's date (again when the
  // currency or the date changes).
  useEffect(() => {
    items.forEach((it) => {
      if (!it.currency || it.currency === 'ILS') return;
      const want = it.currency + ':' + it.date;
      if (it.rateKey === want || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || '')) return;
      onChange((cur) => cur.map((x) => (x.key === it.key ? { ...x, rateKey: want, rate: null, rateDate: null, rateError: '' } : x)));
      getRate(it.currency, it.date)
        .then((r) => onChange((cur) => cur.map((x) => (x.key === it.key && x.rateKey === want ? { ...x, rate: r.rate, rateDate: r.date, rateSource: r.source } : x))))
        .catch((err) => onChange((cur) => cur.map((x) => (x.key === it.key && x.rateKey === want ? { ...x, rateError: err.message } : x))));
    });
  }, [items.map((it) => it.key + it.currency + it.date).join('|')]);
  const remove = (i) => { const key = items[i].key; onChange((cur) => cur.filter((it) => it.key !== key)); };
  const ok = items.length > 0 && items.every(reviewValid);
  const total = items.reduce((s, it) => s + (it.type === 'income' ? 1 : -1) * inShekels(it), 0);

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
          <label class="field" style="flex:1"><span>סכום (${CURRENCIES[it.currency || 'ILS'].symbol})</span><input class="input num" inputmode="decimal" value=${String(it.amount)} onInput=${(e) => set(i, { amount: toNumber(e.target.value) })} /></label>
          <label class="field" style="flex:none;width:84px"><span>מטבע</span>
            <select class="input" value=${it.currency || 'ILS'} aria-label="מטבע" onChange=${(e) => set(i, { currency: e.target.value })}>
              ${Object.entries(CURRENCIES).map(([code, c]) => html`<option value=${code}>${c.symbol} ${c.label}</option>`)}
            </select></label>
        </div>
        ${it.currency && it.currency !== 'ILS' && html`<div class=${'fx-line' + (it.rateError ? ' err' : '')} role="status">
          ${it.rateError ? it.rateError : it.rate ? html`<b class="num">${shekels(inShekels(it))}</b> לפי שער ${it.rateSource === 'ecb' ? '' : 'יציג '}<span class="num">${it.rate}</span> ליום <span class="num">${it.rateDate.split('-').reverse().slice(0, 2).join('.')}</span>${it.rateDate !== it.date ? ' (השער האחרון לפני התאריך)' : ''}` : html`<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> מביא את השער ליום הזה…`}
        </div>`}
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
