import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { myRole, startOverCode, startOver } from '../../data/account.js';
import { showToast } from '../../lib/toast.js';

const WORD = 'להתחיל מחדש';

// Starting over: every money record of the household goes to the recycle
// bin (30 days, back in one tap), the account, partner and settings stay.
// A code sent to the account's email, plus typing the words, confirm it.
export function StartOver({ userId, onDone, onExport }) {
  const [role, setRole] = useState(undefined);
  const [step, setStep] = useState('closed');
  const [to, setTo] = useState('');
  const [code, setCode] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (userId) myRole(userId).then(setRole).catch(() => setRole(null)); }, [userId]);
  const close = () => { setStep('closed'); setCode(''); setWord(''); setError(''); };
  const send = async () => {
    setBusy(true); setError('');
    try {
      const r = await startOverCode();
      setTo(r.to || ''); setStep('code');
    } catch (err) { setError(err.message || 'לא הצלחנו לשלוח קוד. נסו שוב.'); }
    setBusy(false);
  };
  const go = async () => {
    if (busy || word.trim() !== WORD || code.replace(/\D/g, '').length !== 6) return;
    setBusy(true); setError('');
    try {
      const r = await startOver(code.replace(/\D/g, ''), WORD);
      showToast('הנתונים נמחקו. אפשר להחזיר הכל מ"נמחקו לאחרונה" עד 30 יום.');
      close();
      onDone && onDone(r);
    } catch (err) { setError(err.message || 'המחיקה לא הושלמה. נסו שוב.'); }
    setBusy(false);
  };

  if (step === 'closed') {
    return html`<div class="card stack start-over" role="region" aria-label="להתחיל מחדש">
      <b>להתחיל מחדש</b>
      <span class="muted" style="font-size:13px;line-height:1.6">מוחקים את כל הנתונים הכספיים של הבית: תנועות, קבצים שהועלו, תקציבים, יעדים, הלוואות, השקעות וחשבונות. החשבון, בן או בת הזוג וההגדרות נשארים.</span>
      <span class="muted" style="font-size:13px;line-height:1.6">הכל עובר ל"נמחקו לאחרונה" ל-30 יום, ואפשר להחזיר בלחיצה אחת.</span>
      ${error && html`<p class="error" role="alert">${error}</p>`}
      ${role && role !== 'owner' ? html`<span class="faint" style="font-size:12px;line-height:1.6">רק מי שפתח את הבית באפליקציה יכול להתחיל מחדש. אפשר לבקש ממנו.</span>` : html`<div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 14px" disabled=${busy} onClick=${onExport}>קודם להוריד עותק</button>
        <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 14px;color:var(--danger);border-color:var(--danger)" disabled=${busy} onClick=${send}>${busy ? 'שולח קוד…' : 'להתחיל מחדש'}</button>
      </div>`}
    </div>`;
  }

  const ready = word.trim() === WORD && code.replace(/\D/g, '').length === 6;
  return html`<div class="card stack start-over" role="region" aria-label="להתחיל מחדש">
    <b style="color:var(--danger)">להתחיל מחדש</b>
    <span class="muted" style="font-size:13px;line-height:1.6">שלחנו קוד בן 6 ספרות ${to ? html`אל <bdi dir="ltr">${to}</bdi>` : 'למייל של החשבון'}. הוא בתוקף 10 דקות.</span>
    <label class="field"><span>הקוד מהמייל</span>
      <input class="input num" inputmode="numeric" autocomplete="one-time-code" maxlength="7" value=${code} onInput=${(e) => setCode(e.target.value)} /></label>
    <label class="field"><span>כדי לאשר, כתבו: <b>${WORD}</b></span>
      <input class="input" autocomplete="off" value=${word} onInput=${(e) => setWord(e.target.value)} /></label>
    <span class="faint" style="font-size:12px;line-height:1.6">מי שגר איתכם בבית יקבל מייל שהנתונים נמחקו, ואיך להחזיר אותם.</span>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    <div style="display:flex;gap:10px">
      <button type="button" class="btn btn-ghost" style="flex:1;color:var(--danger);border-color:var(--danger)" disabled=${!ready || busy} onClick=${go}>${busy ? 'מוחק…' : 'למחוק ולהתחיל מחדש'}</button>
      <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 14px" disabled=${busy} onClick=${close}>ביטול</button>
    </div>
    <button type="button" class="btn-text" style="align-self:flex-start;font-size:13px" disabled=${busy} onClick=${send}>לא הגיע? לשלוח קוד חדש</button>
  </div>`;
}
