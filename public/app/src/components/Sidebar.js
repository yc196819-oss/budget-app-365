import { html } from '../lib/html.js';
import { TABS, hrefFor } from '../domain/routes.js';
import { Icon } from './Icon.js';
import { go } from '../lib/go.js';

// Desktop navigation: same tabs as the mobile bottom bar.
export function Sidebar({ tab, onAdd, onImport, onLearn, onProfile, profile, badges = {}, mini = false, onMini }) {
  const tip = (t) => (mini ? t : undefined);
  return html`
    <aside class="sidebar">
      <div class="brand"><img class="brand-mark" src="/wallet.svg" alt="" /><span class="side-label">התקציב שלנו</span>
        ${onMini && html`<button type="button" class="icon-btn side-mini" aria-pressed=${String(mini)} aria-label=${mini ? 'להרחיב את התפריט' : 'להקטין את התפריט'} title=${mini ? 'להרחיב את התפריט' : 'להקטין את התפריט'} onClick=${onMini}><${Icon} name="panel" size=${18} /></button>`}
      </div>
      <nav aria-label="ניווט ראשי" class="stack" style="gap:4px">
        ${TABS.map((t) => html`
          <a class="side-item" href=${hrefFor(t.key)} aria-current=${tab === t.key ? 'page' : 'false'} title=${tip(t.label)} aria-label=${mini ? t.label : undefined}>
            <${Icon} name=${t.icon} /><span class="side-label">${t.label}</span>${badges[t.key] > 0 && html`<span class="nav-badge side">${badges[t.key]}</span>`}
          </a>`)}
      </nav>
      <div class="side-sep"></div>
      <button type="button" class="btn" title=${tip('הוספת הוצאה')} aria-label=${mini ? 'הוספת הוצאה' : undefined} onClick=${onAdd}><${Icon} name="plus" size=${19} stroke=${2.6} /><span class="side-label">הוספת הוצאה</span><kbd title="קיצור מקלדת">N</kbd></button>
      ${onImport && html`<button type="button" class="btn btn-ghost" style="margin-top:6px" title=${tip('העלאת פירוט')} aria-label=${mini ? 'העלאת פירוט' : undefined} onClick=${onImport}><${Icon} name="upload" size=${18} /><span class="side-label">העלאת פירוט</span><kbd title="קיצור מקלדת">U</kbd></button>`}
      ${onLearn && html`<button type="button" class="side-item" style="border:0;background:transparent;margin-top:8px" title=${tip('פינת הלמידה')} aria-label=${mini ? 'פינת הלמידה' : undefined} onClick=${onLearn}><${Icon} name="book" /><span class="side-label">פינת הלמידה</span></button>`}
      <button type="button" class="side-item side-talk" style="border:0;background:transparent" title=${tip('כתבו לנו: תקלה או רעיון')} aria-label=${mini ? 'כתבו לנו: תקלה או רעיון' : undefined} onClick=${() => go('profile/feedback')}><${Icon} name="chat" /><span class="side-label">כתבו לנו: תקלה או רעיון</span></button>
      <div class="side-spacer"></div>
      <button type="button" class="side-profile" title=${tip('פרופיל והגדרות')} onClick=${onProfile}>
        <span class="icon-btn" style="width:38px;height:38px;font-size:14px;position:relative">${profile.initials}${badges.profile > 0 && html`<span class="fb-dot" aria-hidden="true">${badges.profile}</span>`}</span>
        <span class="side-label side-who">
          <b style="font-size:14px">${profile.name}</b>
          <span class="muted" style="font-size:12px">${badges.profile > 0 ? 'יש תשובה לפנייה שלך' : 'פרופיל והגדרות'}</span>
        </span>
      </button>
    </aside>`;
}
