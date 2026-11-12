import { html } from '../../lib/html.js';
import { TEXT_SIZES, setTextSize } from '../../lib/textsize.js';
import { readLocal } from '../../lib/storage.js';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { setAiEnabled, autoLearn, setAutoLearn } from '../../lib/settings.js';
import { useAiSetting } from '../advisor/useAiSetting.js';
import { InviteButton } from '../../components/InviteButton.js';
import { useEffect, useState } from 'preact/hooks';
import { monthlyMailOn, setMonthlyMail } from '../../data/account.js';
import { showToast } from '../../lib/toast.js';
import { MemoriesView } from './MemoriesView.js';
import { PushToggle } from '../../components/PushToggle.js';
import { InstallCard } from '../../components/InstallCard.js';
import { ShareCard } from '../../components/ShareCard.js';
import { DeleteAccount } from './DeleteAccount.js';
import { DataView } from './DataView.js';
import { AdminView } from './AdminView.js';
import { FeedbackView } from './FeedbackView.js';
import { SecurityView } from './SecurityView.js';
import { telemetryOn, setTelemetry } from '../../lib/telemetry.js';
import { useOwner } from '../../lib/owner.js';

function TextSize() {
  const [size, setSize] = useState(() => readLocal('text:size', ''));
  return html`<div class="stack text-size" style="gap:6px">
    <b style="font-size:14px;color:var(--muted)">גודל הטקסט</b>
    <div class="chips" role="radiogroup" aria-label="גודל הטקסט">${TEXT_SIZES.map((t) => html`<button type="button" role="radio" class="chip" aria-checked=${String(size === t.key)} aria-pressed=${String(size === t.key)} onClick=${() => { setTextSize(t.key); setSize(t.key); }} style=${'font-size:' + Math.round(13 * t.zoom) + 'px'}>${t.label}</button>`)}</div>
  </div>`;
}

export function ProfileSheet({ answers = 0, start = 'main', profile, theme, onTheme, onSignOut, onClose, hid, userId }) {
  const aiOn = useAiSetting();
  const [view, setView] = useState(() => ((hid && ['memories', 'data'].includes(start)) || ['feedback', 'security'].includes(start) ? start : 'main'));
  const [usage, setUsage] = useState(telemetryOn);
  const [learnAuto, setLearnAuto] = useState(autoLearn);
  const [monthly, setMonthly] = useState(null);
  useEffect(() => { if (userId) monthlyMailOn(userId).then(setMonthly).catch(() => setMonthly(null)); }, [userId]);
  const toggleMonthly = async (on) => {
    setMonthly(on);
    try { await setMonthlyMail(userId, on); } catch (_e) { setMonthly(!on); showToast('לא נשמר. נסו שוב.'); }
  };
  const isAdmin = useOwner(profile.email);
  if (view === 'memories') {
    return html`<${Sheet} title="מה היועץ יודע עלינו" onClose=${onClose}><${MemoriesView} hid=${hid} userId=${userId} onBack=${() => setView('main')} /><//>`;
  }
  if (view === 'data') {
    return html`<${Sheet} title="המידע שלנו" onClose=${onClose}><${DataView} hid=${hid} userId=${userId} onBack=${() => setView('main')} /><//>`;
  }
  if (view === 'feedback') {
    return html`<${Sheet} title="פנייה אלינו" onClose=${onClose}><${FeedbackView} userId=${userId} onBack=${() => setView('main')} /><//>`;
  }
  if (view === 'security') {
    return html`<${Sheet} title="האבטחה שלך" onClose=${onClose}><${SecurityView} onBack=${() => setView('main')} onOpenData=${hid ? () => setView('data') : null} /><//>`;
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
      <${ShareCard} />
      <button type="button" class=${'btn btn-ghost' + (answers > 0 ? ' fb-has-answer' : '')} onClick=${() => setView('feedback')}><${Icon} name="wrench" /><span style="flex:1;text-align:start">תקלות ורעיונות לשיפור</span>${answers > 0 && html`<span class="fb-pill fb-pill-new">${answers === 1 ? 'תשובה חדשה' : answers + ' תשובות חדשות'}</span>`}</button>
      <label class="check toggle-row">
        <span style="flex:1;display:flex;flex-direction:column"><b>היועץ והצעות AI</b>
          <span class="muted" style="font-size:12px;line-height:1.5">${aiOn ? 'כשאתם שואלים, היועץ מקבל את המספרים שלכם, שמות בתי העסק והתנועות האחרונות, כדי לענות על המקרה שלכם (לא מספרי חשבון או כרטיס). כבוי: שום נתון לא נשלח.' : 'כבוי: שום נתון לא נשלח ל-AI מהמכשיר הזה.'}</span></span>
        <input type="checkbox" role="switch" checked=${aiOn} onChange=${(e) => setAiEnabled(e.target.checked)} aria-label="היועץ והצעות AI" />
      </label>
      ${aiOn && html`<label class="check toggle-row">
        <span style="flex:1;display:flex;flex-direction:column"><b>היועץ מעדכן לבד מהשיחות</b>
          <span class="muted" style="font-size:12px;line-height:1.5">${learnAuto ? 'כשמספרים לו על יעד, תקציב, הכנסה או החלטה, הוא מעדכן את הנתונים ומראה מה שינה, עם אפשרות לבטל.' : 'הוא שואל לפני כל עדכון.'}</span></span>
        <input type="checkbox" role="switch" checked=${learnAuto} onChange=${(e) => { setAutoLearn(e.target.checked); setLearnAuto(e.target.checked); }} aria-label="היועץ מעדכן לבד מהשיחות" />
      </label>`}
      <label class="check toggle-row">
        <span style="flex:1;display:flex;flex-direction:column"><b>עזרה בשיפור האפליקציה</b>
          <span class="muted" style="font-size:12px;line-height:1.5">שולח דיווח כשמשהו נשבר, ואילו פעולות נעשו (למשל "נוספה הוצאה"). בלי סכומים, שמות או מה שכתבתם.</span></span>
        <input type="checkbox" role="switch" checked=${usage} onChange=${(e) => { setTelemetry(e.target.checked); setUsage(e.target.checked); }} aria-label="עזרה בשיפור האפליקציה" />
      </label>
      ${monthly !== null && html`<label class="check toggle-row">
        <span style="flex:1;display:flex;flex-direction:column"><b>סיכום חודשי במייל</b>
          <span class="muted" style="font-size:12px;line-height:1.5">בתחילת כל חודש: כמה נכנס ויצא, מה בלט, ו-3 דברים לחודש הבא.</span></span>
        <input type="checkbox" role="switch" checked=${monthly} onChange=${(e) => toggleMonthly(e.target.checked)} aria-label="סיכום חודשי במייל" />
      </label>`}
      <button type="button" class="btn btn-ghost" onClick=${() => setView('security')}><${Icon} name="shield" />האבטחה שלך: כניסה בשני שלבים ומכשירים</button>
      <${InstallCard} always=${true} />
      ${hid && html`<${PushToggle} userId=${userId} hid=${hid} />`}
      ${hid && html`<button type="button" class="btn btn-ghost" onClick=${() => setView('memories')}><${Icon} name="book" />מה היועץ יודע עלינו</button>`}
      ${hid && html`<button type="button" class="btn btn-ghost" onClick=${() => setView('data')}><${Icon} name="box" />המידע שלנו: קבצים, ייצוא ושחזור</button>`}
      ${hid && html`<${InviteButton} hid=${hid} userId=${userId} />`}
      ${isAdmin && html`<button type="button" class="btn btn-ghost" onClick=${() => setView('admin')}><${Icon} name="chart" />לוח בעלים</button>`}
      <${TextSize} />
      <button type="button" class="btn btn-ghost" onClick=${onTheme}><${Icon} name="sun" />${theme === 'light' ? 'מצב כהה' : 'מצב בהיר'}</button>
      <button type="button" class="btn btn-ghost" style="color:var(--danger)" onClick=${onSignOut}><${Icon} name="logout" />יציאה</button>
      <p class="faint" style="font-size:12px;margin:0">ביציאה נמחקים מהמכשיר גם מפתחות ונתונים רגישים ששמורים בו.</p>
      <p class="faint" style="font-size:12px;margin:0"><a href="/terms" target="_blank" rel="noopener">תנאי שימוש</a> · <a href="/privacy" target="_blank" rel="noopener">מדיניות פרטיות</a> · <a href="/accessibility" target="_blank" rel="noopener">הצהרת נגישות</a></p>
      <${DeleteAccount} onDeleted=${onSignOut} />
    <//>`;
}
