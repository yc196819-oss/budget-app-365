import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { adminToday, adminEmail } from '../../data/account.js';
import { HEALTH, todaySummary, healthCounts } from '../../domain/people-health.js';

const dm = (iso) => (iso ? String(iso).slice(5, 10).split('-').reverse().join('.') : '—');

// A person's email, shown only when asked for.
function Reveal({ who }) {
  const [email, setEmail] = useState(null);
  const [busy, setBusy] = useState(false);
  if (email) return html`<span class="people-email"><bdi dir="ltr">${email}</bdi> <button type="button" class="btn-text" onClick=${() => navigator.clipboard && navigator.clipboard.writeText(email)}>להעתיק</button></span>`;
  return html`<button type="button" class="btn-text people-reveal" disabled=${busy} onClick=${async () => { setBusy(true); setEmail((await adminEmail(who)) || 'לא נמצא'); setBusy(false); }}>${busy ? '…' : 'להציג מייל'}</button>`;
}

function Chip({ health }) {
  const h = HEALTH[health.level] || HEALTH.good;
  return html`<span class=${'people-chip lv-' + health.level} title=${(health.reasons || []).join(' · ')}>${h.mark} ${health.label}</span>`;
}

// "Who came in today?": one tap, a sentence, then each person.
export function TodayCard() {
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); setT(await adminToday()); setBusy(false); };
  return html`<div class="card stack admin-today">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:17px">היום</b>
      <button type="button" class="btn" style="width:auto;padding:0 16px" disabled=${busy} onClick=${load}>${busy ? 'בודק…' : t ? 'לרענן' : 'מי נכנס היום?'}</button></div>
    ${t === null && !busy && html`<span class="muted" style="font-size:14px">לחיצה אחת: מי נכנס היום, מה עשה, כמה AI השתמש, ומי צריך עזרה.</span>`}
    ${t === undefined && html`<span class="muted" style="font-size:14px">לא הצלחנו לבדוק. נסו שוב.</span>`}
    ${t && html`<span class="today-summary" style="font-size:15px;line-height:1.6">${todaySummary(t.items)}</span>
      <div class="people-list">${t.items.map((p) => html`<div class="people-row" key=${p.who}>
        <span class="people-top"><b>${p.name || html`בלי שם · <bdi dir="ltr">${p.who}</bdi>`}${p.newToday ? html` <span class="people-new">חדש היום</span>` : ''}</b><span class="muted">${p.first === p.last ? p.first : p.first + '–' + p.last}</span></span>
        <span class="people-did">${[p.opens ? p.opens + ' כניסות' : '', p.imports ? p.imports + ' פירוטים' : '', p.importFails ? p.importFails + ' פירוטים נכשלו' : '', p.added ? p.added + ' הוספות' : '', p.asked ? p.asked + ' שאלות ליועץ' : '', p.aiCalls ? 'עלות AI $' + p.cost.toFixed(2) : '', p.errors ? p.errors + ' שגיאות' : ''].filter(Boolean).join(' · ') || 'רק נכנס'}</span>
        <span style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><${Chip} health=${p.health} /><${Reveal} who=${p.who} /></span>
      </div>`)}</div>`}
  </div>`;
}

// Everyone, with how each one is doing; filter by state.
export function PeopleCard({ users, aiCost, costNote, sharing }) {
  const [filter, setFilter] = useState('all');
  const counts = healthCounts(users);
  const shown = users.filter((u) => filter === 'all' || u.health.level === filter);
  return html`<div class="card stack per-user people">
    <b>המשתמשים (30 יום)</b>
    <span class="muted" style="font-size:14px;line-height:1.55">שם כפי שנתנו באפליקציה, ומה הם עשו (בלי סכומים ובלי מה שכתבו). המייל מופיע רק בלחיצה. החשבונות שלך לא נספרים. עלות AI החודש, של כולם: <b class="num">$${aiCost}</b>${costNote}.</span>
    ${sharing && html`<span class="people-sharing" style="font-size:14px;line-height:1.55">שיתוף עם חברים: <b class="num">${sharing.sharers}</b> שיתפו (<b class="num">${sharing.shares}</b> פעמים ב-30 יום) · הצטרפו דרכם <b class="num">${sharing.friends}</b>${sharing.mine && (sharing.mine.shares || sharing.mine.friends) ? html` <span class="muted">· דרכך: שיתפת ${sharing.mine.shares}, הצטרפו ${sharing.mine.friends}</span>` : ''}</span>`}
    <div class="chips" role="group" aria-label="סינון">${[['all', 'הכול', users.length], ...Object.entries(HEALTH).map(([k, h]) => [k, h.name, counts[k] || 0])].map(([k, l, n]) => html`<button type="button" class="chip" aria-pressed=${String(filter === k)} onClick=${() => setFilter(k)}>${l} · ${n}</button>`)}</div>
    <div class="people-list">${shown.map((u) => html`<div class="people-row" key=${u.who}>
      <span class="people-top"><b>${u.name || html`בלי שם · <bdi dir="ltr">${u.who}</bdi>`}</b><span class="muted">הצטרף ${dm(u.joined)} · נראה ${dm(u.lastSeen)}</span></span>
      <span class="people-did">${[u.opens + ' כניסות', u.imports + ' פירוטים', u.importFails ? u.importFails + ' נכשלו' : '', u.added + ' הוספות', u.asked + ' שאלות', u.aiCalls ? u.tokens.toLocaleString('he-IL') + ' טוקנים · $' + u.cost.toFixed(2) : '', u.shares ? 'שיתף ' + u.shares : '', u.friends ? 'הצטרפו דרכו ' + u.friends : ''].filter(Boolean).join(' · ')}</span>
      ${u.health.reasons && u.health.reasons.length > 0 && html`<span class="people-why">${u.health.reasons.join(' · ')}</span>`}
      <span style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><${Chip} health=${u.health} /><${Reveal} who=${u.who} /></span>
    </div>`)}</div>
  </div>`;
}
