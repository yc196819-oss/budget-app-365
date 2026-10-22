import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { adminStats } from '../../data/account.js';

const NAMES = { app_open: 'פתיחות', tx_add: 'הוספת תנועה', import_done: 'ייבוא', advisor_ask: 'שאלות ליועץ', advisor_talk: 'שיחה קולית', decision_open: 'החלטה חדשה', decision_message: 'הודעות ביחד', trip_plan: 'תכנון טיול', news_open: 'חדשות', lesson_done: 'שיעור', shortcut: 'קיצור דרך', export: 'ייצוא', restore: 'שחזור' };

// The owner's dashboard: who uses the app, who came back, what broke.
export function AdminView({ onBack }) {
  const [s, setS] = useState(undefined);
  useEffect(() => { adminStats().then(setS); }, []);
  const tile = (label, value) => html`<div class="card" style="flex:1;text-align:center;padding:12px"><b class="num" style="font-size:22px">${value}</b><div class="muted" style="font-size:12px">${label}</div></div>`;
  return html`<div class="stack admin-stats">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ חזרה</button>
    ${s === undefined && html`<span class="muted">טוען…</span>`}
    ${s === null && html`<span class="muted">הנתונים לא זמינים כרגע.</span>`}
    ${s && html`
      <div style="display:flex;gap:8px">${tile('היום', s.active.day)}${tile('השבוע', s.active.week)}${tile('החודש', s.active.month)}</div>
      <div class="card stack"><b>חזרו אחרי שבוע</b>
        <span class="muted" style="font-size:14px">${s.retention.pct === null ? 'עוד אין מספיק נתונים.' : html`<b class="num">${s.retention.pct}%</b> (${s.retention.cameBack} מתוך ${s.retention.started} שהתחילו לפני 8–60 יום)`}</span>
        <span class="faint" style="font-size:12px">חשבונות רשומים: <span class="num">${s.members}</span></span></div>
      <div class="card stack"><b>מה משתמשים (30 יום)</b>
        ${s.use.length === 0 ? html`<span class="muted">עוד אין.</span>` : s.use.map((u) => html`<div style="display:flex;justify-content:space-between"><span>${NAMES[u.name] || u.name}</span><b class="num">${u.count}</b></div>`)}</div>
      <div class="card stack"><b>תקלות השבוע: <span class="num">${s.errors.week}</span></b>
        ${s.errors.top.map((e) => html`<div style="font-size:13px"><b class="num">${e.count}×</b> ${e.message}<div class="faint" style="font-size:11px">${e.path || ''}</div></div>`)}</div>`}
  </div>`;
}
