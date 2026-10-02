import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { sb } from '../../lib/supabase.js';
import { readLocal } from '../../lib/storage.js';
import { PENDING_INVITE } from '../../data/onboarding.js';

const MESSAGES = {
  'Invalid login credentials': 'האימייל או הסיסמה לא נכונים',
  'Email not confirmed': 'צריך לאשר את האימייל לפני הכניסה. בדקו את תיבת הדואר.',
  'User already registered': 'כבר יש חשבון עם האימייל הזה. נסו להיכנס, או לאפס סיסמה.'
};

export function LoginScreen() {
  // A new person who came from an invite link starts on sign-up.
  const [mode, setMode] = useState(() => (readLocal(PENDING_INVITE, '') ? 'register' : 'login'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    if (!email.trim() || !password) { setError('נא למלא אימייל וסיסמה'); return; }
    if (mode === 'register' && password.length < 8) { setError('סיסמה של 8 תווים לפחות'); return; }
    setBusy(true);
    if (mode === 'register') {
      const invite = readLocal(PENDING_INVITE, '');
      const { data, error: err } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: name.trim() || email.trim().split('@')[0], invite_code: invite || undefined }, emailRedirectTo: location.origin + '/app/' }
      });
      setBusy(false);
      if (err) { setError(MESSAGES[err.message] || 'ההרשמה נכשלה. נסו שוב.'); return; }
      // With email confirmation on, there is no session until the link is clicked.
      if (!data.session) setNotice('נרשמתם! שלחנו מייל לאימות לכתובת ' + email.trim() + '. לחצו על הקישור בו, ותחזרו לכאן.');
      return;
    }
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(MESSAGES[err.message] || 'הכניסה נכשלה. נסו שוב.');
  };

  const reset = async () => {
    setError(''); setNotice('');
    if (!email.trim()) { setError('כתבו קודם את האימייל, ואז לחצו שוב'); return; }
    const { error: err } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + '/app/' });
    if (err) setError('לא הצלחנו לשלוח מייל. נסו שוב בעוד רגע.');
    else setNotice('אם האימייל רשום, נשלח אליו קישור לאיפוס הסיסמה.');
  };

  return html`
    <main class="login">
      <div class="brand-login"><img class="brand-mark" src="/icon.svg" alt="" /><b class="display" style="font-size:22px">התקציב שלנו</b></div>
      <h1 class="display" style="font-size:36px;line-height:1.1;margin:0">לדעת בכל רגע כמה נשאר להוציא</h1>
      <div class="seg" role="group" aria-label="כניסה או הרשמה">
        <button type="button" aria-pressed=${String(mode === 'login')} onClick=${() => { setMode('login'); setError(''); setNotice(''); }}>כניסה</button>
        <button type="button" aria-pressed=${String(mode === 'register')} onClick=${() => { setMode('register'); setError(''); setNotice(''); }}>הרשמה</button>
      </div>
      <form class="stack" onSubmit=${submit} noValidate>
        ${mode === 'register' && html`<label class="field"><span>איך לקרוא לכם?</span>
          <input class="input" autocomplete="given-name" value=${name} onInput=${(e) => setName(e.target.value)} /></label>`}
        <label class="field"><span>אימייל</span>
          <input class="input" type="email" autocomplete="email" dir="ltr" value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
        <label class="field"><span>סיסמה</span>
          <input class="input" type="password" autocomplete=${mode === 'register' ? 'new-password' : 'current-password'} dir="ltr" value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
        ${error && html`<p class="error" role="alert">${error}</p>`}
        ${notice && html`<p class="notice" role="status">${notice}</p>`}
        <button class="btn" type="submit" disabled=${busy}>${busy ? '…' : mode === 'register' ? 'הרשמה' : 'כניסה'}</button>
        ${mode === 'login' && html`<button class="btn-text" type="button" onClick=${reset}>שכחתי סיסמה</button>`}
      </form>
      <p class="faint" style="font-size:13px">זו הגרסה החדשה, בבנייה. אפשר לעבור לגרסה הקודמת בכל רגע: <a href="/old/">לגרסה הקודמת</a></p>
    </main>`;
}
