import { html } from '../../lib/html.js';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { setAiEnabled } from '../../lib/settings.js';
import { useAiSetting } from '../advisor/useAiSetting.js';
import { InviteButton } from '../../components/InviteButton.js';
import { useState } from 'preact/hooks';
import { MemoriesView } from './MemoriesView.js';
import { PushToggle } from '../../components/PushToggle.js';
import { InstallCard } from '../../components/InstallCard.js';
import { DeleteAccount } from './DeleteAccount.js';
import { DataView } from './DataView.js';
import { AdminView } from './AdminView.js';
import { telemetryOn, setTelemetry } from '../../lib/telemetry.js';
import { CONFIG } from '../../config.js';

export function ProfileSheet({ profile, theme, onTheme, onSignOut, onClose, hid, userId }) {
  const aiOn = useAiSetting();
  const [view, setView] = useState('main');
  const [usage, setUsage] = useState(telemetryOn);
  const isAdmin = CONFIG.adminEmails.includes(String(profile.email || '').toLowerCase());
  if (view === 'memories') {
    return html`<${Sheet} title="מה היועץ יודע עלינו" onClose=${onClose}><${MemoriesView} hid=${hid} userId=${userId} onBack=${() => setView('main')} /><//>`;
  }
  if (view === 'data') {
    return html`<${Sheet} title="המידע שלנו" onClose=${onClose}><${DataView} hid=${hid} userId=${userId} onBack=${() => setView('main')} /><//>`;
  }
  if (view === 'admin') {
    return html`<${Sheet} title="לוח בעלים" onClose=${onClose}><${AdminView} onBack=${() => setView('main')} /><//>`;
  }
  return html`
    <${Sheet} title="פרופיל והגדרות" onClose=${onClose}>
      <div class="card" style="display:flex;align-items:center;gap:14px">
        <span class="icon-btn" style="width:52px;height:52px;background:var(--accent);color:var(--accent-ink);font-size:18px">${profile.initials}</span>
        <span style="display:flex;flex-direction:column;min-width:0">
          <b style="font-size:17px">${profile.name}</b>
          <span class="muted num" style="font-size:13px;text-align:right">${profile.email}</span>
        </span>
      </div>
      <label class="check toggle-row">
        <span style="flex:1;display:flex;flex-direction:column"><b>היועץ והצעות AI</b>
          <span class="muted" style="font-size:12px;line-height:1.5">${aiOn ? 'כשאתם שואלים, נשלח סיכום של המספרים (לא שמות בתי עסק מלאים או פרטי חשבון). כבוי: שום נתון לא נשלח.' : 'כבוי: שום נתון לא נשלח ל-AI מהמכשיר הזה.'}</span></span>
        <input type="checkbox" role="switch" checked=${aiOn} onChange=${(e) => setAiEnabled(e.target.checked)} aria-label="היועץ והצעות AI" />
      </label>
      <label class="check toggle-row">
        <span style="flex:1;display:flex;flex-direction:column"><b>עזרה בשיפור האפליקציה</b>
          <span class="muted" style="font-size:12px;line-height:1.5">שולח דיווח כשמשהו נשבר, ואילו פעולות נעשו (למשל "נוספה הוצאה"). בלי סכומים, שמות או מה שכתבתם.</span></span>
        <input type="checkbox" role="switch" checked=${usage} onChange=${(e) => { setTelemetry(e.target.checked); setUsage(e.target.checked); }} aria-label="עזרה בשיפור האפליקציה" />
      </label>
      <${InstallCard} always=${true} />
      ${hid && html`<${PushToggle} userId=${userId} hid=${hid} />`}
      ${hid && html`<button type="button" class="btn btn-ghost" onClick=${() => setView('memories')}>🧠 מה היועץ יודע עלינו</button>`}
      ${hid && html`<button type="button" class="btn btn-ghost" onClick=${() => setView('data')}>📦 ייצוא המידע ונמחקו לאחרונה</button>`}
      ${hid && html`<${InviteButton} hid=${hid} userId=${userId} />`}
      ${isAdmin && html`<button type="button" class="btn btn-ghost" onClick=${() => setView('admin')}>📊 לוח בעלים</button>`}
      <button type="button" class="btn btn-ghost" onClick=${onTheme}><${Icon} name="sun" />${theme === 'light' ? 'מצב כהה' : 'מצב בהיר'}</button>
      <a class="btn btn-ghost" href="/old/" style="text-decoration:none">לגרסה הקודמת של האפליקציה</a>
      <button type="button" class="btn btn-ghost" style="color:var(--danger)" onClick=${onSignOut}><${Icon} name="logout" />יציאה</button>
      <p class="faint" style="font-size:12px;margin:0">ביציאה נמחקים מהמכשיר גם מפתחות ונתונים רגישים ששמורים בו.</p>
      <p class="faint" style="font-size:12px;margin:0"><a href="/terms" target="_blank" rel="noopener">תנאי שימוש</a> · <a href="/privacy" target="_blank" rel="noopener">מדיניות פרטיות</a> · <a href="/accessibility" target="_blank" rel="noopener">הצהרת נגישות</a></p>
      <${DeleteAccount} onDeleted=${onSignOut} />
    <//>`;
}
