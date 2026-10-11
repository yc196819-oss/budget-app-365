import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { api } from '../../lib/api.js';
import { showToast } from '../../lib/toast.js';

const WORD = 'מחיקה';

// Deleting the account, from inside the app (Google Play requires it).
// Two steps: open, then type the word. A household the person is alone in
// is deleted with all its data; a shared one stays with the partner.
export function DeleteAccount({ onDeleted }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return html`<button type="button" class="btn-text" style="color:var(--danger);align-self:flex-start" onClick=${() => setOpen(true)}>מחיקת החשבון</button>`;

  const go = async () => {
    if (word.trim() !== WORD || busy) return;
    setBusy(true); setError('');
    try {
      await api('/api/account/delete', { method: 'POST', body: { confirm: WORD } });
      showToast('החשבון נמחק');
      onDeleted();
    } catch (err) {
      setBusy(false);
      setError(err.message || 'המחיקה לא הושלמה. נסו שוב.');
    }
  };
  return html`<div class="card stack delete-account" role="region" aria-label="מחיקת החשבון">
    <b style="color:var(--danger)">מחיקת החשבון</b>
    <span class="muted" style="font-size:13px;line-height:1.6">
      נמחקים פרטי הכניסה שלכם. אם אתם לבד במשק הבית, נמחקים גם כל הנתונים שבו. אם הוא משותף עם בן או בת זוג, הנתונים המשותפים נשארים אצלם ואתם רק יוצאים ממנו. אי אפשר לבטל.
    </span>
    <label class="field"><span>כדי לאשר, כתבו: <b>${WORD}</b></span>
      <input class="input" value=${word} onInput=${(e) => setWord(e.target.value)} autocomplete="off" /></label>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    <div style="display:flex;gap:10px">
      <button type="button" class="btn" style="background:var(--danger);color:#fff" disabled=${word.trim() !== WORD || busy} onClick=${go}>${busy ? 'מוחק…' : 'למחוק לצמיתות'}</button>
      <button type="button" class="btn btn-ghost" disabled=${busy} onClick=${() => { setOpen(false); setWord(''); setError(''); }}>ביטול</button>
    </div>
  </div>`;
}
