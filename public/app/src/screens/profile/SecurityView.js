import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { showToast } from '../../lib/toast.js';
import { totpApps, startTotp, confirmTotp, removeTotp, emailStatus, sendEmailCode, enableEmail, disableEmail, mySessions, signOutOthers, cleanCode, deviceName } from '../../data/security.js';

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' }) : '');

// A 6-digit code box with its button.
function CodeForm({ label, busy, onSubmit, onCancel }) {
  const [code, setCode] = useState('');
  const submit = (e) => { e.preventDefault(); if (cleanCode(code).length === 6) onSubmit(code); };
  return html`<form class="stack" style="gap:8px" onSubmit=${submit} noValidate>
    <label class="field"><span>${label}</span>
      <input class="input num" dir="ltr" inputmode="numeric" autocomplete="one-time-code" maxlength="7" style="font-size:22px;letter-spacing:6px;text-align:center"
        value=${code} onInput=${(e) => setCode(e.target.value)} /></label>
    <div style="display:flex;gap:8px">
      <button class="btn" type="submit" style="flex:1" disabled=${busy || cleanCode(code).length !== 6}>${busy ? '…' : 'אישור'}</button>
      <button class="btn btn-ghost" type="button" style="flex:1" onClick=${onCancel}>ביטול</button>
    </div>
  </form>`;
}

// "Your security": two-step login (by app or by email), where the account is
// signed in, and what is kept.
export function SecurityView({ onBack, onOpenData }) {
  const [apps, setApps] = useState(null);
  const [mail, setMail] = useState(null);
  const [devices, setDevices] = useState(null);
  const [adding, setAdding] = useState(null); // { factorId, qr, secret } | 'email'
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sure, setSure] = useState('');

  const load = () => {
    totpApps().then(setApps).catch(() => setApps([]));
    emailStatus().then(setMail).catch(() => setMail({ failed: true }));
    mySessions().then(setDevices).catch(() => setDevices([]));
  };
  useEffect(load, []);

  const run = async (key, fn, done) => {
    setBusy(key); setError('');
    try { await fn(); if (done) showToast(done); setAdding(null); setSure(''); load(); } catch (e) { setError(e.message || 'משהו נכשל. נסו שוב.'); }
    setBusy('');
  };
  const startApp = async () => {
    setBusy('app'); setError('');
    try { setAdding(await startTotp()); } catch (_e) { setError('לא הצלחנו להתחיל. נסו שוב.'); }
    setBusy('');
  };
  const startEmail = async () => {
    setBusy('email'); setError('');
    try { await sendEmailCode('enable'); setAdding('email'); } catch (e) { setError(e.message); }
    setBusy('');
  };

  const appOn = apps && apps.length > 0;
  const emailOn = mail && mail.emailOn;
  const anyOn = appOn || emailOn;
  const others = (devices || []).filter((d) => !d.current);

  return html`<div class="stack security">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ חזרה</button>

    <section class="card stack" style="gap:10px" aria-labelledby="sec-2step">
      <b id="sec-2step" style="font-size:17px">כניסה בשני שלבים</b>
      <span class="muted" style="font-size:13px;line-height:1.6">אחרי הסיסמה מבקשים גם קוד חד-פעמי. גם אם מישהו ידע את הסיסמה, הוא לא ייכנס בלי הקוד. בוחרים דרך אחת או שתיהן.</span>
      <span class=${anyOn ? 'sec-tag sec-on' : 'sec-tag'} role="status">${anyOn ? 'פועל' : 'כבוי'}</span>

      <div class="sec-row">
        <span style="flex:1;display:flex;flex-direction:column;gap:2px"><b>קוד מאפליקציה</b>
          <span class="muted" style="font-size:12px;line-height:1.5">Google Authenticator, Microsoft Authenticator או דומה. עובד גם בלי אינטרנט.</span></span>
        ${apps === null ? html`<span class="skel" style="width:60px"></span>`
          : appOn ? (sure === 'app'
            ? html`<button type="button" class="btn btn-ghost" style="color:var(--danger)" disabled=${busy === 'app'} onClick=${() => run('app', () => removeTotp(apps[0].id), 'הקוד מהאפליקציה כובה')}>בטוח? לכבות</button>`
            : html`<button type="button" class="btn btn-ghost" onClick=${() => setSure('app')}>לכבות</button>`)
          : !adding && html`<button type="button" class="btn" disabled=${busy === 'app'} onClick=${startApp}>להפעיל</button>`}
      </div>
      ${adding && adding.factorId && html`<div class="card stack sec-steps" style="gap:10px">
        <span>1. התקינו בטלפון אפליקציית קודים (למשל Google Authenticator).</span>
        <span>2. באפליקציה לחצו על "+", וסרקו את הריבוע:</span>
        <img src=${adding.qr} alt="קוד QR לסריקה באפליקציית הקודים" width="180" height="180" style="align-self:center;background:#fff;border-radius:12px;padding:8px" />
        <span class="muted" style="font-size:13px">או הקלידו באפליקציה את המפתח: <b dir="ltr" class="num" style="word-break:break-all">${adding.secret}</b></span>
        <span>3. הקלידו כאן את הקוד שמופיע באפליקציה:</span>
        <${CodeForm} label="הקוד מהאפליקציה" busy=${busy === 'appok'} onCancel=${() => { setAdding(null); setError(''); }}
          onSubmit=${(code) => run('appok', () => confirmTotp(adding.factorId, code), 'מעולה! מעכשיו נבקש קוד מהאפליקציה בכל כניסה')} />
      </div>`}

      <div class="sec-row">
        <span style="flex:1;display:flex;flex-direction:column;gap:2px"><b>קוד במייל</b>
          <span class="muted" style="font-size:12px;line-height:1.5">${emailOn ? html`נשלח ל-<span dir="ltr">${mail.emailMasked}</span> בכל כניסה.` : 'בכל כניסה נשלח קוד למייל של החשבון.'}</span></span>
        ${mail === null ? html`<span class="skel" style="width:60px"></span>`
          : emailOn ? (sure === 'email'
            ? html`<button type="button" class="btn btn-ghost" style="color:var(--danger)" disabled=${busy === 'email'} onClick=${() => run('email', disableEmail, 'הקוד במייל כובה')}>בטוח? לכבות</button>`
            : html`<button type="button" class="btn btn-ghost" onClick=${() => setSure('email')}>לכבות</button>`)
          : mail.failed || !mail.mailReady ? html`<span class="muted" style="font-size:12px">עוד לא זמין</span>`
          : adding !== 'email' && html`<button type="button" class="btn" disabled=${busy === 'email'} onClick=${startEmail}>להפעיל</button>`}
      </div>
      ${adding === 'email' && html`<div class="card stack" style="gap:8px">
        <span>שלחנו קוד ל-<span dir="ltr">${mail && mail.emailMasked}</span>. הקלידו אותו כאן כדי להפעיל:</span>
        <${CodeForm} label="הקוד מהמייל" busy=${busy === 'emailok'} onCancel=${() => { setAdding(null); setError(''); }}
          onSubmit=${(code) => run('emailok', () => enableEmail(code), 'מעולה! מעכשיו נשלח קוד למייל בכל כניסה')} />
      </div>`}
      ${error && html`<p class="error" role="alert">${error}</p>`}
    </section>

    <section class="card stack" style="gap:10px" aria-labelledby="sec-devices">
      <b id="sec-devices" style="font-size:17px">איפה החשבון מחובר</b>
      ${devices === null && html`<div class="skel-row"><span class="skel" style="width:70%"></span><span class="skel" style="width:50%"></span></div>`}
      ${devices && devices.length === 0 && html`<span class="muted">לא הצלחנו לטעון את הרשימה.</span>`}
      ${(devices || []).map((d) => html`<div class="sec-row" key=${d.id}>
        <span style="flex:1;display:flex;flex-direction:column;gap:2px"><b>${deviceName(d.user_agent)}</b>
          <span class="muted" style="font-size:12px">${d.current ? 'המכשיר הזה' : 'פעיל לאחרונה ' + day(d.last_seen)}</span></span>
        ${d.current && html`<span class="sec-tag sec-on">כאן</span>`}
      </div>`)}
      ${others.length > 0 && (sure === 'others'
        ? html`<button type="button" class="btn" style="background:var(--danger)" disabled=${busy === 'others'} onClick=${() => run('others', signOutOthers, 'כל המכשירים האחרים נותקו')}>בטוח? לנתק ${others.length === 1 ? 'מכשיר אחד' : others.length + ' מכשירים'}</button>`
        : html`<button type="button" class="btn btn-ghost" onClick=${() => setSure('others')}>לנתק את כל המכשירים האחרים</button>`)}
      <span class="faint" style="font-size:12px;line-height:1.5">לא מזהים מכשיר? נתקו את כולם, ושנו סיסמה.</span>
    </section>

    <section class="card stack" style="gap:8px" aria-labelledby="sec-kept">
      <b id="sec-kept" style="font-size:17px">מה שמור אצלנו</b>
      <ul class="sec-list">
        <li>התנועות, הקטגוריות, התקציבים והיעדים שהעליתם או כתבתם. רק אתם ומי שהזמנתם למשק הבית רואים אותם.</li>
        <li>אין לנו חיבור לבנק, ואנחנו לא מבקשים סיסמת בנק או אשראי.</li>
        <li>הסיסמה שלכם לא נשמרת כמו שהיא, אלא בצורה מוצפנת שאי אפשר לקרוא.</li>
        <li>כל החיבור לאתר מוצפן (HTTPS).</li>
      </ul>
      ${onOpenData && html`<button type="button" class="btn btn-ghost" onClick=${onOpenData}>להוריד הכל או למחוק קבצים</button>`}
      <a href="/security" target="_blank" rel="noopener" style="font-size:13px">כל שכבות ההגנה: איך אנחנו שומרים עליכם</a>
      <a href="/privacy" target="_blank" rel="noopener" style="font-size:13px">מדיניות הפרטיות המלאה</a>
    </section>
  </div>`;
}
