import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { sb } from '../../lib/supabase.js';
import { consentData } from '../../domain/legal.js';

// Before the app: the terms of use and the privacy policy, confirmed once
// (and again when they change). The confirmation is kept on the account.
export function TermsGate({ session }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accept = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError('');
    const { error: err } = await sb.auth.updateUser({ data: consentData() });
    if (err) { setBusy(false); setError('לא הצלחנו לשמור. בדקו את החיבור ונסו שוב.'); return; }
    session.refresh();
  };
  return html`<main class="login terms-gate">
    <div class="brand-login"><img class="brand-mark" src="/wallet.svg" alt="" /><b class="display" style="font-size:22px">התקציב שלנו</b></div>
    <h1 class="display" style="font-size:30px;line-height:1.15;margin:0">לפני שממשיכים</h1>
    <div class="card stack" style="gap:10px;font-size:15px;line-height:1.6">
      <span>האפליקציה עוזרת לנהל את התקציב, עם יועץ שמבוסס על בינה מלאכותית. חשוב לדעת:</span>
      <ul class="terms-points">
        <li>התשובות, התחזיות והחישובים הם <b>מידע כללי</b>, לא ייעוץ השקעות, מס, פנסיה או משפט.</li>
        <li>בינה מלאכותית <b>יכולה לטעות</b>. בדקו את המספרים לפני החלטה, והחלטות גדולות עשו עם בעל רישיון.</li>
        <li>הנתונים שלכם נשמרים בחשבון שלכם, ומשותפים רק עם מי שהזמנתם.</li>
      </ul>
    </div>
    <form class="stack" onSubmit=${accept}>
      <label class="check terms-check">
        <input type="checkbox" checked=${ok} onChange=${(e) => setOk(e.target.checked)} />
        <span>קראתי ואני מסכים/ה ל<a href="/terms" target="_blank" rel="noopener">תנאי השימוש</a> ול<a href="/privacy" target="_blank" rel="noopener">מדיניות הפרטיות</a></span>
      </label>
      ${error && html`<p class="error" role="alert">${error}</p>`}
      <button class="btn" type="submit" disabled=${!ok || busy}>${busy ? 'שומר…' : 'להמשיך'}</button>
      <button class="btn-text" type="button" onClick=${session.signOut}>יציאה</button>
    </form>
    <p class="faint" style="font-size:13px"><a href="/accessibility" target="_blank" rel="noopener">הצהרת נגישות</a></p>
  </main>`;
}
