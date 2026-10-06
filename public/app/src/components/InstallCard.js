import { html } from '../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { subscribe, env, mode, promptInstall, dismiss, dismissedAt } from '../lib/install.js';
import { showInstallCard } from '../domain/install.js';
import { showToast } from '../lib/toast.js';

// A suggestion to install the app on the phone: it opens at once, full
// screen, from the home screen, and on iPhone only an installed app gets
// notifications. One button where the browser can install; elsewhere the
// two steps. On the home screen it can be put off ("not now", 14 days);
// in the profile (always) it stays while the app is not installed.
export function InstallCard({ always = false }) {
  const [, setTick] = useState(0);
  const [steps, setSteps] = useState(false);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  const m = mode();
  if (always ? m === 'hidden' : !showInstallCard(env(), dismissedAt())) return null;

  const install = async () => {
    if (m !== 'prompt') { setSteps(true); return; }
    if (await promptInstall()) showToast('האפליקציה הותקנה. מעכשיו פותחים אותה ממסך הבית.');
  };
  return html`<div class="card install-card" role="region" aria-label="התקנת האפליקציה">
    <div class="install-head">
      <img src="/wallet.svg" alt="" class="install-icon" />
      <span class="stack" style="gap:2px;min-width:0"><b>להתקין את האפליקציה בטלפון</b>
        <span class="muted" style="font-size:13px;line-height:1.5">נפתחת מיד ממסך הבית, במסך מלא${m === 'ios' ? ', ורק כך אפשר לקבל התראות באייפון' : ', עם התראות'}.</span></span>
    </div>
    ${steps && m === 'ios' && html`<ol class="install-steps">
      <li>לוחצים על כפתור השיתוף <svg class="share-glyph" viewBox="0 0 24 24" width="17" height="17" aria-label="שיתוף" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M7 10H5v11h14V10h-2"/></svg> בתחתית ספארי (ריבוע עם חץ למעלה)</li>
      <li>גוללים ובוחרים <b>"הוספה למסך הבית"</b>, ואז <b>"הוסף"</b></li>
    </ol>`}
    ${steps && m === 'manual' && html`<ol class="install-steps">
      <li>פותחים את תפריט הדפדפן <b>⋮</b> (למעלה או למטה)</li>
      <li>בוחרים <b>"הוספה למסך הבית"</b> או <b>"התקנת אפליקציה"</b></li>
    </ol>`}
    <div class="install-actions">
      ${!steps && html`<button type="button" class="btn" onClick=${install}>${m === 'prompt' ? 'להתקין' : 'איך מתקינים'}</button>`}
      ${!always && html`<button type="button" class="btn-text" onClick=${dismiss}>לא עכשיו</button>`}
    </div>
  </div>`;
}
