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
    <p class="faint" style="font-size:12px;line-height:1.55;margin:0">
      קובץ אקסל נקרא כאן במכשיר. ל-AI נשלחים רק שמות של בתי עסק שעוד לא סיווגתם, כדי להציע קטגוריה.
      PDF וצילום נשלחים ל-AI כדי לקרוא אותם. לפני השמירה תראו הכול ותוכלו לתקן.
    </p>`;
}
