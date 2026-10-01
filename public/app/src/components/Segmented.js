import { html } from '../lib/html.js';

export function Segmented({ options, value, onChange, label, variant = 'seg' }) {
  return html`<div class=${variant} role="group" aria-label=${label}>
    ${options.map((o) => html`<button type="button" aria-pressed=${String(value === o.key)} onClick=${() => onChange(o.key)}>${o.label}</button>`)}
  </div>`;
}
