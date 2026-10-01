import { html } from '../../lib/html.js';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { setAiEnabled } from '../../lib/settings.js';
import { useAiSetting } from '../advisor/useAiSetting.js';
import { InviteButton } from '../../components/InviteButton.js';

export function ProfileSheet({ profile, theme, onTheme, onSignOut, onClose, hid, userId }) {
  const aiOn = useAiSetting();
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
      ${hid && html`<${InviteButton} hid=${hid} userId=${userId} />`}
      <button type="button" class="btn btn-ghost" onClick=${onTheme}><${Icon} name="sun" />${theme === 'light' ? 'מצב כהה' : 'מצב בהיר'}</button>
      <a class="btn btn-ghost" href="/" style="text-decoration:none">לגרסה הנוכחית של האפליקציה</a>
      <button type="button" class="btn btn-ghost" style="color:var(--danger)" onClick=${onSignOut}><${Icon} name="logout" />יציאה</button>
      <p class="faint" style="font-size:12px;margin:0">ביציאה נמחקים מהמכשיר גם מפתחות ונתונים רגישים ששמורים בו.</p>
    <//>`;
}
