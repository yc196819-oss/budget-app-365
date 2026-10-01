import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { sb } from '../../lib/supabase.js';
import { Icon } from '../../components/Icon.js';

const MESSAGES = {
  'Invalid login credentials': 'האימייל או הסיסמה לא נכונים',
  'Email not confirmed': 'צריך לאשר את האימייל לפני הכניסה. בדקו את תיבת הדואר.'
};

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    if (!email.trim() || !password) { setError('נא למלא אימייל וסיסמה'); return; }
    setBusy(true);
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(MESSAGES[err.message] || 'הכניסה נכשלה. נסו שוב.');
  };

  const reset = async () => {
    setError(''); setNotice('');
    if (!email.trim()) { setError('כתבו קודם את האימייל, ואז לחצו שוב'); return; }
    // The current app handles the reset link.
    const { error: err } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + '/' });
    if (err) setError('לא הצלחנו לשלוח מייל. נסו שוב בעוד רגע.');
    else setNotice('אם האימייל רשום, נשלח אליו קישור לאיפוס הסיסמה.');
  };

  return html`
    <main class="login">
      <div class="brand-login"><span class="brand-mark"><${Icon} name="spark" size=${20} stroke=${2.2} /></span><b class="display" style="font-size:22px">התקציב שלנו</b></div>
      <h1 class="display" style="font-size:36px;line-height:1.1;margin:0">לדעת בכל רגע כמה נשאר להוציא</h1>
      <form class="stack" onSubmit=${submit} noValidate>
        <label class="field"><span>אימייל</span>
          <input class="input" type="email" autocomplete="email" dir="ltr" value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
        <label class="field"><span>סיסמה</span>
          <input class="input" type="password" autocomplete="current-password" dir="ltr" value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
        ${error && html`<p class="error" role="alert">${error}</p>`}
        ${notice && html`<p class="notice" role="status">${notice}</p>`}
        <button class="btn" type="submit" disabled=${busy}>${busy ? 'נכנסים…' : 'כניסה'}</button>
        <button class="btn-text" type="button" onClick=${reset}>שכחתי סיסמה</button>
      </form>
      <p class="faint" style="font-size:13px">זו הגרסה החדשה, בבנייה. אפשר לחזור לגרסה הנוכחית בכל רגע: <a href="/">לגרסה הנוכחית</a></p>
    </main>`;
}
