import { html } from '../lib/html.js';
import { TABS, hrefFor } from '../domain/routes.js';
import { Icon } from './Icon.js';

// Mobile navigation: two tabs, the "+" button, two tabs.
export function BottomNav({ tab, onAdd }) {
  const item = (t) => html`
    <a class="nav-item" href=${hrefFor(t.key)} aria-current=${tab === t.key ? 'page' : 'false'}>
      <span class="pill"><${Icon} name=${t.icon} /></span>${t.label}
    </a>`;
  return html`
    <nav class="bottom-nav" aria-label="ניווט ראשי">
      ${TABS.slice(0, 2).map(item)}
      <button type="button" class="nav-add" aria-label="הוספת הוצאה" onClick=${onAdd}><${Icon} name="plus" size=${26} stroke=${2.6} /></button>
      ${TABS.slice(2).map(item)}
    </nav>`;
}
