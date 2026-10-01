import { html } from '../lib/html.js';
import { Icon } from './Icon.js';
import { SoonCard } from './SoonCard.js';

// Desktop: the advisor sits next to every screen. On mobile it opens from
// the "שאל את היועץ" button instead. Built in stage 5.
export function AdvisorRail() {
  return html`
    <aside class="rail" aria-label="היועץ">
      <div class="rail-head">
        <span class="orb"><${Icon} name="spark" size=${19} stroke=${2.2} /></span>
        <span style="display:flex;flex-direction:column"><b style="font-size:17px">היועץ</b><span class="muted" style="font-size:12px">מתעדכן לפי המסך</span></span>
      </div>
      <${SoonCard} stage="שלב 5" title="יועץ שמכיר את המספרים שלכם"
        items=${['תובנה אחת חשובה לכל מסך', 'תשובות שמחושבות מהנתונים, עם כפתורי פעולה', 'שאלה בכתב או בהקלטה']} />
    </aside>`;
}
