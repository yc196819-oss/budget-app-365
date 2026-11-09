import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';

// Reading a file, calmly: a page being scanned, one line for what is being
// done now, a short thought under it, and how far along it is.
const STEPS = [
  { key: 'read', label: 'קוראים את הקובץ', thoughts: ['פותחים את הקובץ', 'מחפשים את טבלת העסקאות'] },
  { key: 'find', label: 'מזהים את התנועות', thoughts: ['מוצאים תאריכים וסכומים', 'מזהים של מי הפירוט'] },
  { key: 'sort', label: 'מסווגים לקטגוריות', thoughts: ['לפי מה שבחרתם בעבר', 'וכל השאר בעזרת AI'] },
  { key: 'dupes', label: 'בודקים כפילויות', thoughts: ['משווים מול מה שכבר שמור', 'וחיובי אשראי שלא ייספרו פעמיים'] }
];

export function Steps({ step, fileName }) {
  const at = Math.max(0, STEPS.findIndex((s) => s.key === step));
  const s = STEPS[at];
  // The thought under the step changes every moment, while the step runs.
  const [tick, setTick] = useState(0);
  useEffect(() => { setTick(0); const t = setInterval(() => setTick((n) => n + 1), 1100); return () => clearInterval(t); }, [step]);
  const thought = s.thoughts[tick % s.thoughts.length];
  return html`<div class="scan" role="status" aria-live="polite">
    <div class="scan-doc" aria-hidden="true"><i style="top:16px"></i><i style="top:28px;inset-inline-end:30px"></i><i style="top:40px"></i><i style="top:52px;inset-inline-end:22px"></i><i style="top:64px"></i><i style="top:76px;inset-inline-end:34px"></i><span class="scan-sweep"></span></div>
    <div class="scan-status"><span key=${s.key}>${s.label}</span></div>
    <div class="scan-thought"><span key=${s.key + tick}>${thought}…</span></div>
    <div class="scan-track"><i style=${'width:' + ((at + 0.5) / STEPS.length) * 100 + '%'}></i></div>
    <div class="scan-count">${at + 1} מתוך ${STEPS.length}${fileName ? ' · ' + fileName : ''}</div>
  </div>`;
}

// What the check found, before the lines: a mark (fine, a question, a
// problem), a title, and the list of what was checked.
export function Checked({ tone, title, text, checks, children }) {
  return html`<div class="scan-result">
    <div class=${'scan-mark ' + tone} aria-hidden="true"><${Icon} name=${tone === 'ok' ? 'check' : 'alert'} size=${26} stroke=${2.4} /></div>
    <h3>${title}</h3>
    ${text && html`<p class="muted">${text}</p>`}
    <ul class="import-checks" aria-label="בדיקת הקובץ">${checks.map((c, i) => html`<li key=${i} class=${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'warn'}><i aria-hidden="true">${c.ok === true ? '✓' : '!'}</i>${c.text}</li>`)}</ul>
    ${children && html`<div class="scan-acts">${children}</div>`}
  </div>`;
}
