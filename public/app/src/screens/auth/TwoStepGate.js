import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { setScreen } from '../../lib/telemetry.js';
import { Icon } from '../../components/Icon.js';
import { passTotp, passEmail, sendEmailCode, cleanCode } from '../../data/security.js';

// After the password: the second step, for whoever turned it on. Until it
// passes, the database shows nothing of the household.
export function TwoStepGate({ session }) {
  setScreen('twostep');
  const st = session.mfa || {};
  const [way, setWay] = useState(st.totp ? 'app' : 'email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  const send = async () => {
    setError(''); setBusy(true);
    try { const r = await sendEmailCode('login'); setSentTo(r.to || 'המייל שלכם'); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (cleanCode(code).length !== 6) { setError('הקוד הוא 6 ספרות'); return; }
    setBusy(true);
    try {
      if (way === 'app') await passTotp(code); else await passEmail(code);
      session.refresh();
    } catch (err) { setError(err.message || 'הבדיקה נכשלה. נסו שוב.'); setBusy(false); }
  };
  const pick = (w) => { setWay(w); setCode(''); setError(''); };
  const ready = way === 'app' || sentTo;

  return html`
    <main class="login">
      <div class="brand-login"><img class="brand-mark" src="/wallet.svg" alt="" /><b class="display" style="font-size:22px">התקציב שלנו</b></div>
      <div class="stack" style="gap:8px">
        <h1 class="display" style="font-size:30px;line-height:1.15;margin:0;display:flex;align-items:center;gap:10px"><${Icon} name="shield" size=${28} />עוד שלב אחד</h1>
        <p class="muted" style="margin:0;line-height:1.6">הפעלתם כניסה בשני שלבים. ${way === 'app' ? 'פתחו את אפליקציית הקודים (כמו Google Authenticator) והקלידו את הקוד שמופיע בה.' : 'נשלח קוד של 6 ספרות למייל שלכם.'}</p>
      </div>
      ${st.totp && st.email && html`<div class="seg" role="group" aria-label="איך לקבל קוד">
        <button type="button" aria-pressed=${String(way === 'app')} onClick=${() => pick('app')}>קוד מהאפליקציה</button>
        <button type="button" aria-pressed=${String(way === 'email')} onClick=${() => pick('email')}>קוד במייל</button>
      </div>`}
      ${way === 'email' && html`<div class="stack" style="gap:8px">
        ${sentTo && html`<p class="notice" role="status">שלחנו קוד ל-<span dir="ltr">${sentTo}</span>. הוא בתוקף ל-10 דקות. לא הגיע? בדקו בספאם.</p>`}
        <button type="button" class=${sentTo ? 'btn-text' : 'btn'} onClick=${send} disabled=${busy}>${sentTo ? 'לשלוח קוד חדש' : 'שלחו לי קוד במייל'}</button>
      </div>`}
      ${ready && html`<form class="stack" onSubmit=${submit} noValidate>
        <label class="field"><span>הקוד</span>
          <input class="input num" dir="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength="7" style="font-size:24px;letter-spacing:6px;text-align:center"
            value=${code} onInput=${(e) => setCode(e.target.value)} aria-label="הקוד בן 6 הספרות" /></label>
        <button class="btn" type="submit" disabled=${busy}>${busy ? '…' : 'אישור'}</button>
      </form>`}
      ${error && html`<p class="error" role="alert">${error}</p>`}
      <button type="button" class="btn-text" onClick=${session.signOut}>יציאה, ולהיכנס עם חשבון אחר</button>
    </main>`;
}
