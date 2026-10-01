import { html } from '../../lib/html.js';
import { Icon } from '../../components/Icon.js';

const STEPS = [
  { key: 'read', label: 'קוראים את הקובץ' },
  { key: 'find', label: 'מוצאים את התנועות' },
  { key: 'sort', label: 'מסווגים לפי מה שבחרתם בעבר' },
  { key: 'dupes', label: 'בודקים כפילויות' }
];

export function Steps({ step, fileName }) {
  const at = STEPS.findIndex((s) => s.key === step);
  return html`<div class="steps" role="status" aria-live="polite">
    <span class="muted" style="font-size:13px">${fileName}</span>
    ${STEPS.map((s, i) => html`<div class=${'step' + (i < at ? ' done' : i === at ? ' active' : '')}>
      <span class="step-dot">${i < at && html`<${Icon} name="check" size=${13} stroke=${3} />`}</span>${s.label}
    </div>`)}
  </div>`;
}
