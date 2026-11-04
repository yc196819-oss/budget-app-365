import { html } from '../../lib/html.js';
import { Icon } from '../../components/Icon.js';
import { useEffect, useState } from 'preact/hooks';
import { createHousehold } from '../../data/onboarding.js';
import { track, setScreen } from '../../lib/telemetry.js';
import { setAiEnabled } from '../../lib/settings.js';
import { QUICK_START } from '../../domain/onboarding.js';

let reported = false;

// A new user: two questions on one screen (a name, alone or together), and
// straight into the app. Everything else (cards, income, fixed costs, the
// partner's invite) is asked later, in the setup guide on the home screen.
export function Onboarding({ session }) {
  setScreen('onboarding');
  const meta = session.user.user_metadata || {};
  const [name, setName] = useState(() => meta.display_name || (meta.full_name || meta.name || '').split(' ')[0] || '');
  const [mode, setMode] = useState('together');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!reported) { reported = true; track('onboard_0'); } }, []);

  const start = async (e) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    try {
      setAiEnabled(true);
      await createHousehold(session.user, { ...QUICK_START, name: name.trim(), mode });
      track('onboard_done');
      location.hash = '#/home';
      session.refresh();
    } catch (err) {
      setError('לא הצלחנו לשמור. בדקו את החיבור ונסו שוב. (' + (err.message || err) + ')');
      setSaving(false);
    }
  };

  return html`<main class="login onb">
    <form class="stack onb-body" onSubmit=${start} style="flex:1">
      <span class="muted" style="font-size:15px;font-weight:700">ברוכים הבאים ל"התקציב שלנו"</span>
      <h1 class="display" style="font-size:32px;line-height:1.15;margin:0">רק שתי שאלות, ומתחילים</h1>
      <label class="field"><span>איך לקרוא לכם?</span>
        <input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="השם הפרטי" autocomplete="given-name" /></label>
      <span class="field-label">מנהלים את התקציב</span>
      <div class="seg" role="group" aria-label="מנהלים את התקציב">
        <button type="button" aria-pressed=${String(mode === 'solo')} onClick=${() => setMode('solo')}>לבד</button>
        <button type="button" aria-pressed=${String(mode === 'together')} onClick=${() => setMode('together')}>ביחד</button>
      </div>
      ${mode === 'together' && html`<span class="muted rise" style="font-size:14px;line-height:1.55">נשלח לכם קישור הזמנה לבן או בת הזוג מתוך האפליקציה, מתי שנוח.</span>`}
      <div class="card onb-perk" style="align-items:flex-start">
        <span aria-hidden="true" style="color:var(--income)"><${Icon} name="shield" size=${20} /></span>
        <span class="muted" style="font-size:14px;line-height:1.55">כל השאר (כרטיסים, הכנסה, הוצאות קבועות) אפשר להוסיף אחר כך. היועץ החכם פעיל, ואפשר לכבות אותו בפרופיל.</span>
      </div>
      ${error && html`<p class="error" role="alert">${error}</p>`}
      <div class="stack" style="gap:8px;margin-top:auto">
        <button type="submit" class="btn" disabled=${!name.trim() || saving}>${saving ? 'מכינים…' : 'יאללה, מתחילים'}</button>
        <button type="button" class="btn-text" onClick=${session.signOut}>זה לא החשבון שלי, להתנתק</button>
      </div>
    </form>
  </main>`;
}
