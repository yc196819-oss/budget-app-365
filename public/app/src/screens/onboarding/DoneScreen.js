import { html } from '../../lib/html.js';
import { Icon } from '../../components/Icon.js';
import { InviteButton } from '../../components/InviteButton.js';
import { categoriesFor, cleanCards, firstPicture } from '../../domain/onboarding.js';
import { money } from '../../domain/format.js';

// What was set up, and the first things worth doing.
export function DoneScreen({ answers: a, membership, session }) {
  const cards = cleanCards(a.cards);
  const pic = firstPicture(a);
  const together = a.mode === 'together';
  const rows = [
    ['משק הבית', together ? (a.name || 'אתם') + (a.partner ? ' ו' + a.partner : '') + ' · תקציב משותף' : (a.name || 'אתם') + ' · תקציב אישי'],
    ['קטגוריות', categoriesFor(a.life).length + ' קטגוריות'],
    ['כרטיסים', cards.length ? cards.map((c) => c.name + (c.type === 'direct' ? ' (חיוב מיידי)' : ' · חיוב ב-' + c.billing_day)).join(', ') : 'עוד לא הוספתם'],
    ['למחיה בחודש', pic.income ? (pic.left < 0 ? '−' : '') + money(pic.left) + (pic.left > 0 ? ' · כ-' + money(pic.perDay) + ' ליום' : '') : 'נשלים אחר כך'],
    ['יועץ AI', a.ai ? 'פעיל · רק סכומים' : 'כבוי']
  ];
  return html`<main class="login onb">
    <span class="onb-check" aria-hidden="true"><${Icon} name="check" size=${34} stroke=${2.6} /></span>
    <h1 class="display" style="font-size:32px;margin:0">${(a.name ? a.name + ', ' : '') + 'הכול מוכן'}</h1>
    <span class="muted">זה מה שהגדרנו. אפשר לשנות הכול בכל רגע.</span>
    <div class="facts">${rows.map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}</div>
    <div class="card stack" style="gap:10px">
      <b>הצעדים הראשונים</b>
      <span class="muted" style="font-size:14px;line-height:1.55">1. להעלות פירוט של 3 חודשים אחורה מחברת האשראי, כדי שהתמונה והיועץ יכירו אתכם מהיום הראשון.<br />2. להוסיף הוצאה ראשונה, בהקלדה מהירה.</span>
      ${together && membership && html`<${InviteButton} hid=${membership.household_id} userId=${session.user.id} partner=${a.partner} />`}
    </div>
    <button type="button" class="btn" onClick=${() => { location.hash = '#/home'; session.refresh(); }}>להיכנס לאפליקציה</button>
  </main>`;
}
