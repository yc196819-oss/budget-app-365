import { html } from '../lib/html.js';
import { TABS, hrefFor } from '../domain/routes.js';
import { Icon } from './Icon.js';

// Desktop navigation: same tabs as the mobile bottom bar.
export function Sidebar({ tab, onAdd, onProfile, profile }) {
  return html`
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark"><${Icon} name="spark" size=${19} stroke=${2.2} /></span>התקציב שלנו</div>
      <nav aria-label="ניווט ראשי" class="stack" style="gap:4px">
        ${TABS.map((t) => html`
          <a class="side-item" href=${hrefFor(t.key)} aria-current=${tab === t.key ? 'page' : 'false'}>
            <${Icon} name=${t.icon} />${t.label}
          </a>`)}
      </nav>
      <div class="side-sep"></div>
      <button type="button" class="btn" onClick=${onAdd}><${Icon} name="plus" size=${19} stroke=${2.6} />הוספת הוצאה</button>
      <div class="side-spacer"></div>
      <button type="button" class="side-profile" onClick=${onProfile}>
        <span class="icon-btn" style="width:38px;height:38px;font-size:14px">${profile.initials}</span>
        <span style="display:flex;flex-direction:column">
          <b style="font-size:14px">${profile.name}</b>
          <span class="muted" style="font-size:12px">פרופיל והגדרות</span>
        </span>
      </button>
    </aside>`;
}
