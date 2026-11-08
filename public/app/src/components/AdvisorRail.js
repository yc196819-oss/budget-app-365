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
export function AdvisorRail({ data, session, screen, floating = false, onHide, onFloat, onPin, onMinimize }) {
  return html`
    <aside class=${floating ? 'rail adv-float' : 'rail'} aria-label="היועץ">
      <div class="rail-head">
        <span class="orb"><${Icon} name="spark" size=${19} stroke=${2.2} /></span>
        <span style="display:flex;flex-direction:column;flex:1"><b style="font-size:17px">היועץ</b><span class="muted" style="font-size:14px">מכיר את המספרים שלכם</span></span>
        ${floating
          ? html`${onPin && html`<button type="button" class="icon-btn rail-pin2" aria-label="להצמיד את היועץ לצד המסך" title="להצמיד לצד המסך (תמיד פתוח)" onClick=${onPin}><${Icon} name="panel" size=${18} /></button>`}
            ${onMinimize && html`<button type="button" class="icon-btn adv-min" aria-label="למזער את היועץ" title="למזער (חוזרים מהכפתור למטה)" onClick=${onMinimize}><${Icon} name="minus" size=${18} /></button>`}`
          : html`<button type="button" class="icon-btn rail-pop" aria-label="לפתוח את היועץ בחלון נפרד" title="לפתוח בחלון נפרד" onClick=${openAdvisorWindow}><${Icon} name="popout" size=${18} /></button>
            ${onFloat && html`<button type="button" class="icon-btn rail-float" aria-label="להפוך את היועץ לחלון צף" title="חלון צף שאפשר למזער" onClick=${onFloat}><${Icon} name="minus" size=${18} /></button>`}
            ${onHide && html`<button type="button" class="icon-btn rail-hide" aria-label="להסתיר את היועץ" title="להסתיר (יישאר כפתור למטה)" onClick=${onHide}><${Icon} name="x" size=${18} /></button>`}`}
      </div>
      ${session.household && data.status === 'ready' ? html`<${AdvisorPanel} data=${data} session=${session} screen=${screen} />` : null}
    </aside>`;
}
