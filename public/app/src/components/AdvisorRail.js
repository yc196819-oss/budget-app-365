import { html } from '../lib/html.js';
import { Icon } from './Icon.js';
import { AdvisorPanel } from '../screens/advisor/AdvisorPanel.js';

// Its own window, next to the app or on another screen.
export function openAdvisorWindow() {
  const w = window.open(location.pathname + '#/advisor', 'budget-advisor', 'popup=yes,width=520,height=820');
  if (w) w.focus(); else location.hash = '#/advisor';
}

// Desktop: the advisor sits next to every screen and knows which one is open.
// On mobile it opens from the "שאל את היועץ" button instead.
export function AdvisorRail({ data, session, screen }) {
  return html`
    <aside class="rail" aria-label="היועץ">
      <div class="rail-head">
        <span class="orb"><${Icon} name="spark" size=${19} stroke=${2.2} /></span>
        <span style="display:flex;flex-direction:column;flex:1"><b style="font-size:17px">היועץ</b><span class="muted" style="font-size:14px">מכיר את המספרים שלכם</span></span>
        <button type="button" class="icon-btn rail-pop" aria-label="לפתוח את היועץ בחלון נפרד" title="לפתוח בחלון נפרד" onClick=${openAdvisorWindow}><${Icon} name="popout" size=${18} /></button>
      </div>
      ${session.household && data.status === 'ready' ? html`<${AdvisorPanel} data=${data} session=${session} screen=${screen} />` : null}
    </aside>`;
}
