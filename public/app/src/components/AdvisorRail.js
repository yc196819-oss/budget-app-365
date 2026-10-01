import { html } from '../lib/html.js';
import { Icon } from './Icon.js';
import { AdvisorPanel } from '../screens/advisor/AdvisorPanel.js';

// Desktop: the advisor sits next to every screen and knows which one is open.
// On mobile it opens from the "שאל את היועץ" button instead.
export function AdvisorRail({ data, session, screen }) {
  return html`
    <aside class="rail" aria-label="היועץ">
      <div class="rail-head">
        <span class="orb"><${Icon} name="spark" size=${19} stroke=${2.2} /></span>
        <span style="display:flex;flex-direction:column"><b style="font-size:17px">היועץ</b><span class="muted" style="font-size:12px">מכיר את המספרים שלכם</span></span>
      </div>
      ${session.household && data.status === 'ready' ? html`<${AdvisorPanel} data=${data} session=${session} screen=${screen} />` : null}
    </aside>`;
}
