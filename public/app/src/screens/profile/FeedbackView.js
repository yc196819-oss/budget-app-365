import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { sendFeedback, myFeedback, FEEDBACK_KIND, FEEDBACK_STATUS } from '../../data/feedback.js';
import { showToast } from '../../lib/toast.js';

// "Write to us": a problem or an idea goes straight to the owner, and the
// answer comes back here.
export function FeedbackView({ userId, onBack }) {
  const [kind, setKind] = useState('bug');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(null);
  const load = () => myFeedback(userId).then(setMine).catch(() => setMine([]));
  useEffect(() => { load(); }, []);
  const send = async (e) => {
    e.preventDefault();
    if (busy || text.trim().length < 3) return;
    setBusy(true);
    try {
      await sendFeedback({ kind, text: text.trim(), screen: String(location.hash || '').replace(/^#\//, '').split('/')[0] || 'home' });
      setText('');
      showToast('נשלח. תודה! התשובה תופיע כאן.');
      load();
    } catch (err) { showToast(err.message || 'לא נשלח. נסו שוב.'); }
    setBusy(false);
  };
  const dm = (iso) => String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('.');
  return html`<div class="stack feedback">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ חזרה</button>
    <form class="card stack" onSubmit=${send}>
      <b>תקלות ורעיונות לשיפור</b>
      <span class="muted" style="font-size:13px;line-height:1.55">משהו לא עובד? יש לכם רעיון? זה מגיע ישר אלינו, ואנחנו קוראים כל פנייה.</span>
      <div class="chips" role="radiogroup" aria-label="סוג הפנייה">${Object.entries(FEEDBACK_KIND).map(([k, v]) => html`<button type="button" role="radio" class="chip" aria-checked=${String(kind === k)} aria-pressed=${String(kind === k)} onClick=${() => setKind(k)}>${v.icon} ${v.label}</button>`)}</div>
      <textarea class="input" rows="5" maxlength="2000" aria-label="הפנייה" value=${text} onInput=${(e) => setText(e.target.value)}
        placeholder=${kind === 'bug' ? 'מה ניסיתם לעשות, ומה קרה במקום?' : kind === 'idea' ? 'מה היה עוזר לכם?' : 'כתבו כאן'}></textarea>
      <span class="faint" style="font-size:12px">לא צריך לכתוב פרטים אישיים או מספרי חשבון.</span>
      <button type="submit" class="btn" disabled=${busy || text.trim().length < 3}>${busy ? 'שולח…' : 'לשלוח'}</button>
    </form>
    ${mine && mine.length > 0 && html`<div class="card stack my-feedback"><b>הפניות שלי</b>
      ${mine.map((f) => html`<div key=${f.id} style="display:flex;flex-direction:column;gap:4px;padding:8px 0;border-bottom:1px solid var(--line)">
        <span style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><span>${FEEDBACK_KIND[f.kind].icon} ${dm(f.created_at)}</span><b style=${'font-size:12px;color:' + (f.status === 'done' ? 'var(--income)' : 'var(--muted)')}>${FEEDBACK_STATUS[f.status]}</b></span>
        <span style="font-size:14px;white-space:pre-wrap">${f.text}</span>
        ${f.owner_note && html`<span class="card" style="font-size:13px;padding:8px 10px;background:var(--surface-2, transparent)"><b>תשובה:</b> ${f.owner_note}</span>`}
      </div>`)}
    </div>`}
  </div>`;
}
