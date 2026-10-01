import { html } from '../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { pushState, enablePush, disablePush } from '../lib/push.js';
import { showToast } from '../lib/toast.js';

const TEXT = {
  on: 'פועלות במכשיר הזה: כרטיסים חדשים, תשובות ותזכורות.',
  off: 'כבויות במכשיר הזה. בלי התראות, כרטיסים ותשובות יחכו עד שתפתחו את האפליקציה.',
  denied: 'נחסמו בדפדפן. אפשר לאפשר התראות לאתר בהגדרות הדפדפן או הטלפון.',
  install: 'באייפון: הוסיפו את האפליקציה למסך הבית (שיתוף ← הוסף למסך הבית), פתחו משם והפעילו כאן.',
  unsupported: 'הדפדפן הזה לא תומך בהתראות.'
};

// Notifications on this device, for "together" cards and answers.
export function PushToggle({ userId, hid }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setState); }, []);
  if (!state) return null;
  const toggle = async (on) => {
    setBusy(true);
    try { if (on) await enablePush({ userId, hid }); else await disablePush(); setState(await pushState()); showToast(on ? 'התראות הופעלו' : 'התראות כובו'); } catch (err) { showToast(err.message || 'לא הצלחנו. נסו שוב.'); setState(await pushState()); }
    setBusy(false);
  };
  const can = state === 'on' || state === 'off';
  return html`<label class="check toggle-row">
    <span style="flex:1;display:flex;flex-direction:column"><b>התראות</b><span class="muted" style="font-size:12px;line-height:1.5">${TEXT[state]}</span></span>
    ${can && html`<input type="checkbox" role="switch" checked=${state === 'on'} disabled=${busy} onChange=${(e) => toggle(e.target.checked)} aria-label="התראות" />`}
  </label>`;
}
