import { html } from '../lib/html.js';
import { TABS, hrefFor } from '../domain/routes.js';
import { Icon } from './Icon.js';

// Mobile navigation: the tabs with the "+" button among them. A tab can
// carry a count (answers waiting for you).
export function BottomNav({ tab, onAdd, badges = {} }) {
  const half = Math.ceil(TABS.length / 2);
  const item = (t) => html`
    <a class="nav-item" href=${hrefFor(t.key)} aria-current=${tab === t.key ? 'page' : 'false'}>
      <span class="pill"><${Icon} name=${t.icon} />${badges[t.key] > 0 && html`<span class="nav-badge" aria-label=${badges[t.key] + ' מחכים לך'}>${badges[t.key]}</span>`}</span>${t.label}
    </a>`;
  return html`
    <nav class="bottom-nav" aria-label="ניווט ראשי">
      ${TABS.slice(0, half).map(item)}
      <button type="button" class="nav-add" aria-label="הוספת הוצאה" onClick=${onAdd}><${Icon} name="plus" size=${26} stroke=${2.6} /></button>
      ${TABS.slice(half).map(item)}
    </nav>`;
}
