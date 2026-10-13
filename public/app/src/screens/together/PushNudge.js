import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { pushState, enablePush } from '../../lib/push.js';
import { showToast } from '../../lib/toast.js';

// "Together" lives on notifications: a card or a message the other one never
// hears about waits for nothing. Asks to turn them on here, on this phone, and
// says when the partner's phone did not get the last one.
export function PushNudge({ userId, hid, partnerPush, names }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setState); }, []);
  const who = names.join(' ו');
  const turnOn = async () => {
    setBusy(true);
    try { await enablePush({ userId, hid }); setState(await pushState()); showToast('התראות הופעלו. מעכשיו כל הודעה תקפוץ לך.'); } catch (err) { showToast(err.message || 'לא הצלחנו. נסו שוב.'); setState(await pushState()); }
    setBusy(false);
  };
  return html`
    ${(state === 'off' || state === 'install') && html`<div class="card stack push-nudge">
      <b>🔔 שההודעות של ${who} יקפצו לך</b>
      <span class="muted" style="font-size:14px">${state === 'install' ? 'באייפון: שיתוף ← הוסף למסך הבית, פותחים משם ומפעילים כאן.' : 'כל כרטיס, תשובה והודעה בשיחה יגיעו כהתראה לטלפון, גם כשהאפליקציה סגורה.'}</span>
      ${state === 'off' && html`<button type="button" class="btn" disabled=${busy} onClick=${turnOn}>להפעיל התראות</button>`}
    </div>`}
    ${partnerPush === 0 && html`<div class="card push-nudge partner" role="status">
      <span>📵 ${who} עוד לא הפעילו התראות בטלפון, אז ההודעות שלך יחכו להם באפליקציה. אפשר לבקש מהם: פרופיל ← התראות.</span>
    </div>`}`;
}
