import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';

const ACCEPT = '.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.txt';

export function PickFile({ onFile }) {
  const [over, setOver] = useState(false);
  const pick = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onFile(f); };
  const drop = (e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); };
  return html`
    <label class=${'drop' + (over ? ' over' : '')} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${drop}>
      <span style="color:var(--accent)"><${Icon} name="file" size=${30} stroke=${1.8} /></span>
      <b>בוחרים את קובץ הפירוט</b>
      <span class="muted">אקסל או PDF מהאתר של חברת האשראי או הבנק. אפשר גם צילום מסך.</span>
      <span class="btn" style="margin-top:6px;width:100%"><${Icon} name="upload" size=${18} stroke=${2.2} />לבחור קובץ</span>
      <input type="file" accept=${ACCEPT} onChange=${pick} aria-label="קובץ פירוט" />
    </label>
    <details class="card how-to-download">
      <summary style="cursor:pointer;font-weight:700">איך מורידים את הפירוט?</summary>
      <ol style="margin:10px 0 0;padding-inline-start:20px;display:flex;flex-direction:column;gap:6px;line-height:1.55;font-size:14px">
        <li>נכנסים לאתר או לאפליקציה של חברת האשראי (כאל, מקס, ישראכרט, אמריקן אקספרס, דיינרס) או של הבנק.</li>
        <li>הולכים לפירוט העסקאות או החיובים, ובוחרים חודש.</li>
        <li>מחפשים "ייצוא לאקסל" או "הורדה" / "הדפסה" כ-PDF, ושומרים את הקובץ.</li>
        <li>חוזרים לכאן ובוחרים את הקובץ. כמה חודשים? מעלים אחד אחרי השני.</li>
      </ol>
      <span class="muted" style="display:block;margin-top:8px;font-size:13px;line-height:1.5">אין כפתור הורדה? צילום מסך של רשימת העסקאות עובד גם.</span>
    </details>
    <p class="faint" style="font-size:12px;line-height:1.55;margin:0">
      קובץ אקסל נקרא כאן במכשיר. ל-AI נשלחים רק שמות של בתי עסק שעוד לא סיווגתם, כדי להציע קטגוריה.
      PDF וצילום נשלחים ל-AI כדי לקרוא אותם. לפני השמירה תראו הכול ותוכלו לתקן.
    </p>`;
}
