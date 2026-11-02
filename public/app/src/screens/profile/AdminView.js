import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { adminStats, adminLive, adminReengage, sendReengage } from '../../data/account.js';
import { adminFeedback, setFeedback, FEEDBACK_KIND, FEEDBACK_STATUS } from '../../data/feedback.js';
import { showToast } from '../../lib/toast.js';

const SCREEN_NAMES = { home: 'בית', money: 'כסף', together: 'ביחד', plans: 'תוכניות', assets: 'נכסים', login: 'כניסה', onboarding: 'הרשמה', other: 'אחר' };
const NAMES = { app_open: 'פתיחות', tx_add: 'הוספת תנועה', import_done: 'ייבוא', advisor_ask: 'שאלות ליועץ', advisor_talk: 'שיחה קולית', decision_open: 'החלטה חדשה', decision_message: 'הודעות ביחד', trip_plan: 'תכנון טיול', news_open: 'חדשות', lesson_done: 'שיעור', shortcut: 'קיצור דרך', export: 'ייצוא', restore: 'שחזור', import_fail: 'ייבוא שנכשל', guide_step: 'צעד במסלול התחלה', guide_skip: 'דילוג במסלול', learn_auto: 'עדכון אוטומטי מהיועץ', learn_undo: 'ביטול עדכון של היועץ', onboard_0: 'הרשמה: מסך פתיחה', onboard_1: 'הרשמה: מי אתם', onboard_2: 'הרשמה: מה רלוונטי', onboard_3: 'הרשמה: כרטיסים', onboard_4: 'הרשמה: הכנסה', onboard_5: 'הרשמה: פרטיות', onboard_done: 'הרשמה הושלמה' };

// The owner's dashboard: who uses the app, who came back, what broke.
export function AdminView({ onBack }) {
  const [s, setS] = useState(undefined);
  const [live, setLive] = useState(null);
  useEffect(() => { adminStats().then((x) => { setS(x); if (x && x.live) setLive(x.live); }); }, []);
  // The live count refreshes every 15 seconds while the dashboard is open.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') adminLive().then((l) => l && setLive(l)); }, 15000);
    return () => clearInterval(t);
  }, []);
  const [inbox, setInbox] = useState(null);
  const [back, setBack] = useState(null);
  const [backSure, setBackSure] = useState('');
  const [backBusy, setBackBusy] = useState('');
  useEffect(() => { adminReengage().then(setBack); }, []);
  // What is happening right now with an email, shown step by step in its row.
  const [job, setJob] = useState({});
  const setJ = (id, j) => setJob((all) => ({ ...all, [id]: j && { ...(all[id] || {}), ...j } }));
  const sendBack = async (c) => {
    if (backSure !== c.id) { setBackSure(c.id); return; }
    setBackSure(''); setBackBusy(c.id);
    const total = c.count;
    setJ(c.id, { kind: 'send', phase: 'sending', step: 1, total, sent: 0, failed: 0, error: '' });
    let sent = 0, failed = 0, error = '';
    try {
      // One at a time, so the bar shows the real progress.
      for (let guard = 0; guard < 500; guard++) {
        const r = await sendReengage(c.id, { limit: 1 });
        sent += r.sent || 0; failed += r.failed || 0; if (r.error) error = r.error;
        setJ(c.id, { step: 2, sent, failed, error });
        if (!r.left || (!r.sent && !r.failed)) break;
      }
      setJ(c.id, { phase: failed && !sent ? 'error' : 'done', step: 3 });
      setBack((bk) => ({ ...bk, campaigns: bk.campaigns.map((x) => (x.id === c.id ? { ...x, count: Math.max(0, x.count - sent - failed) } : x)) }));
    } catch (err) { setJ(c.id, { phase: 'error', error: err.message || 'השליחה נכשלה. נסו שוב.' }); }
    setBackBusy('');
  };
  const testBack = async (c) => {
    setBackBusy('t' + c.id);
    setJ(c.id, { kind: 'test', phase: 'sending', step: 1, error: '' });
    const t = setTimeout(() => setJ(c.id, { step: 2 }), 700);
    try {
      const r = await sendReengage(c.id, { test: true });
      clearTimeout(t);
      setJ(c.id, { phase: 'done', step: 3, to: r.to, provider: r.provider || '' });
    } catch (err) { clearTimeout(t); setJ(c.id, { phase: 'error', error: err.message || 'הניסיון לא נשלח.' }); }
    setBackBusy('');
  };
  const PROVIDER = { resend: 'Resend', smtp: 'Gmail / SMTP', 'google-gmail': 'Gmail' };
  const jobView = (c) => {
    const j = job[c.id];
    if (!j) return null;
    const active = j.phase === 'sending';
    const steps = j.kind === 'test'
      ? ['מכינים את המייל עם העיצוב', 'שולחים לשרת המיילים', 'השרת קיבל את המייל']
      : ['מכינים את רשימת הנמענים', 'שולחים אחד אחד', 'סיימנו'];
    const pct = j.kind === 'send' && j.total ? Math.round(((j.sent + j.failed) / j.total) * 100) : 0;
    return html`<div class=${'mail-job ' + (active ? 'is-active' : j.phase === 'error' ? 'is-error' : 'is-done')} role="status" aria-live="polite">
      <div class="mail-fly" aria-hidden="true"><span class="mail-env">✉️</span><span class="mail-trail"></span></div>
      <ol class="mail-steps">${steps.map((st, i) => {
        const n = i + 1;
        const state = j.phase === 'error' && n >= (j.step || 1) ? 'fail' : n < (j.step || 1) || (n === 3 && j.phase === 'done') ? 'ok' : n === j.step && active ? 'now' : 'wait';
        return html`<li class=${'st-' + state} key=${n}><span class="st-dot">${state === 'ok' ? '✓' : state === 'fail' ? '✗' : ''}</span>${st}</li>`;
      })}</ol>
      ${j.kind === 'send' && html`<div class="mail-bar" aria-hidden="true"><i style=${'width:' + pct + '%'}></i></div>
        <span class="mail-count">נשלחו <b class="num">${j.sent}</b> מתוך <b class="num">${j.total}</b>${j.failed ? html` · <span style="color:var(--danger)">${j.failed} לא נשלחו</span>` : ''}</span>`}
      ${j.phase === 'done' && j.kind === 'test' && html`<span class="mail-result">נשלח אל <bdi dir="ltr">${j.to}</bdi>${j.provider ? ' דרך ' + (PROVIDER[j.provider] || j.provider) : ''}. אם לא הגיע תוך כמה דקות, בדקו בספאם.</span>`}
      ${j.error && html`<span class="mail-result" style="color:var(--danger)">${j.error}</span>`}
    </div>`;
  };
  const [replies, setReplies] = useState({});
  useEffect(() => { adminFeedback().then(setInbox); }, []);
  const act = async (f, patch, done) => {
    try {
      await setFeedback(f.id, patch);
      setInbox((l) => l.map((x) => (x.id === f.id ? { ...x, ...patch } : x)));
      if (done) showToast(done);
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  const today = s && s.daily ? s.daily[s.daily.length - 1] : null;
  const f = s && s.funnel;
  const pct = (n) => (f && f.signups ? Math.round((n / f.signups) * 100) + '%' : '');
  const tile = (label, value) => html`<div class="card" style="flex:1;text-align:center;padding:12px"><b class="num" style="font-size:22px">${value}</b><div class="muted" style="font-size:12px">${label}</div></div>`;
  return html`<div class="stack admin-stats">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ חזרה</button>
    ${s === undefined && html`<span class="muted">טוען…</span>`}
    ${s === null && html`<span class="muted">הנתונים לא זמינים כרגע.</span>`}
    ${live && html`<div class="card stack admin-live" role="status">
      <span style="display:flex;align-items:baseline;gap:10px"><span aria-hidden="true" style="width:10px;height:10px;border-radius:5px;background:var(--income);display:inline-block"></span>
        <b style="font-size:17px">מחוברים עכשיו: <span class="num">${live.users}</span></b>
        <span class="muted" style="font-size:13px">${live.visitors ? '+ ' + live.visitors + ' לא מחוברים (במסך הכניסה)' : ''}</span></span>
      ${live.users + live.visitors > 0 && html`<span class="muted" style="font-size:13px">${Object.entries(live.screens).map(([k, n]) => (SCREEN_NAMES[k] || k) + ' ' + n).join(' · ')}</span>
        <span class="faint" style="font-size:12px">טלפון ${live.devices.mobile} · מחשב ${live.devices.desktop} · מותקנת ${live.installed}</span>`}
      <span class="faint" style="font-size:11px">מתעדכן כל 15 שניות. נספר מי שהאפליקציה פתוחה אצלו ב-2 הדקות האחרונות.</span>
    </div>`}
    ${back && back.campaigns && html`<div class="card stack admin-reengage"><b>✉️ מיילים למשתמשים</b>
      <span class="muted" style="font-size:13px;line-height:1.55">כל מייל נשלח לכל אדם פעם אחת בלבד, ורק כשלוחצים כאן פעמיים. קודם כדאי לשלוח ניסיון לעצמכם.</span>
      ${back.mail && !back.mail.ready && html`<span class="card mail-not-ready" role="status" style="font-size:13px;line-height:1.55;border:1px solid var(--danger)">⚠️ השרת עוד לא מוגדר לשלוח מיילים למשתמשים${back.mail.resendTestOnly ? ' (Resend מוגדר רק בכתובת הניסיון שלו, שמגיעה רק אליכם)' : ''}. צריך לחבר את Brevo (חינם): BREVO_API_KEY ו-BREVO_FROM בהגדרות השרת ב-Render.</span>`}
      ${back.campaigns.map((c) => html`<div class=${'campaign campaign-' + c.id} key=${c.id} style="display:flex;flex-direction:column;gap:6px;padding:8px 0;border-top:1px solid var(--line)">
        <span style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px">${c.title}</b><b class="num">${c.count}</b></span>
        <details><summary style="cursor:pointer;font-size:13px">איך המייל נראה</summary>
          <span style="display:block;font-size:13px;margin:6px 0"><span class="faint">נושא:</span> <b>${c.preview.subject}</b></span>
          <iframe class="mail-preview" src=${'/mail-preview/' + c.id} title=${'המייל: ' + c.preview.subject} sandbox="" loading="lazy" style="width:100%;height:560px;border:0;border-radius:12px;background:#F3EDE6;display:block"></iframe></details>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 12px" disabled=${!!backBusy} onClick=${() => testBack(c)}>${backBusy === 't' + c.id ? 'שולח…' : 'ניסיון אליי'}</button>
          ${c.count > 0 && (!back.mail || back.mail.ready) && html`<button type="button" class=${'btn' + (backSure === c.id ? '' : ' btn-ghost')} style="width:auto;padding:6px 12px" disabled=${!!backBusy} onClick=${() => sendBack(c)}>${backBusy === c.id ? 'שולח…' : backSure === c.id ? 'בטוח? לשלוח עכשיו ל-' + c.count : 'לשלוח ל-' + c.count}</button>`}
          ${c.count === 0 && html`<span class="faint" style="font-size:12px;align-self:center">אין כרגע למי לשלוח</span>`}
        </div>
        ${jobView(c)}
      </div>`)}
    </div>`}
    ${inbox && html`<div class="card stack admin-inbox"><b>🛠️ תקלות ורעיונות מהמשתמשים${inbox.filter((f) => f.status === 'new').length ? ' · ' + inbox.filter((f) => f.status === 'new').length + ' חדשות' : ''}</b>
      ${inbox.length === 0 && html`<span class="muted" style="font-size:13px">עוד אין פניות.</span>`}
      ${inbox.filter((f) => f.status !== 'done' && f.status !== 'wontfix').concat(inbox.filter((f) => f.status === 'done' || f.status === 'wontfix')).slice(0, 40).map((f) => html`<div class="inbox-item" key=${f.id} style=${'display:flex;flex-direction:column;gap:6px;padding:10px 0;border-bottom:1px solid var(--line);' + (f.status === 'done' || f.status === 'wontfix' ? 'opacity:.6' : '')}>
        <span style="display:flex;gap:8px;font-size:12px" class="muted"><b>${FEEDBACK_KIND[f.kind].icon} ${FEEDBACK_KIND[f.kind].label}</b><span>${f.who}</span><span>${String(f.created_at).slice(0, 16).replace('T', ' ')}</span><span>${f.screen || ''} ${f.device || ''}</span><span style="margin-inline-start:auto"><b>${FEEDBACK_STATUS[f.status]}</b></span></span>
        <span style="font-size:14px;white-space:pre-wrap">${f.text}</span>
        ${f.owner_note && html`<span class="faint" style="font-size:12px">התשובה שלך: ${f.owner_note}</span>`}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${['working', 'done', 'wontfix'].filter((st) => st !== f.status).map((st) => html`<button type="button" class="chip" onClick=${() => act(f, { status: st })}>${FEEDBACK_STATUS[st]}</button>`)}
        </div>
        <div style="display:flex;gap:6px">
          <input class="input" style="flex:1" placeholder="תשובה למשתמש (תגיע אליו כהתראה ובאפליקציה)" aria-label=${'תשובה לפנייה של ' + f.who} value=${replies[f.id] || ''} onInput=${(e) => setReplies((r) => ({ ...r, [f.id]: e.target.value }))} />
          <button type="button" class="btn" style="width:auto" disabled=${!(replies[f.id] || '').trim()} onClick=${() => act(f, { owner_note: replies[f.id].trim(), status: f.status === 'new' ? 'working' : f.status, notify: true }, 'התשובה נשלחה').then(() => setReplies((r) => ({ ...r, [f.id]: '' })))}>לענות</button>
        </div>
      </div>`)}
    </div>`}
    ${s && html`
      <div style="display:flex;gap:8px">${tile('פעילים היום', s.active.day)}${tile('השבוע', s.active.week)}${tile('החודש', s.active.month)}</div>
      ${today && html`<div style="display:flex;gap:8px">${tile('נרשמו היום', (f && f.byDay && f.byDay[today.day]) || 0)}${tile('עלות AI היום', '$' + today.cost)}${tile('עלות AI ב-30 יום', '$' + (s.aiCost30d ?? 0))}</div>`}
      ${s.daily && html`<div class="card stack admin-daily"><b>14 הימים האחרונים</b>
        <div style="display:flex;align-items:flex-end;gap:4px;height:90px" aria-label="פעילים לפי יום">
          ${s.daily.map((d) => { const top = Math.max(1, ...s.daily.map((x) => x.active)); return html`<div title=${d.day + ': ' + d.active + ' פעילים, $' + d.cost} style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;justify-content:flex-end;height:100%">
            <span class="num faint" style="font-size:10px">${d.active || ''}</span>
            <i style=${'display:block;width:100%;border-radius:3px 3px 0 0;background:var(--accent);height:' + Math.max(2, Math.round((d.active / top) * 70)) + 'px'}></i>
            <span class="num faint" style="font-size:9px">${Number(d.day.slice(8))}</span></div>`; })}
        </div><span class="faint" style="font-size:11px">גובה = משתמשים פעילים ביום. מעבר עם העכבר מראה גם את עלות ה-AI.</span></div>`}
      ${f && html`<div class="card stack admin-funnel"><b>מהרשמה לשימוש (30 יום)</b>
        ${[['נרשמו', f.signups], ['הקימו משק בית', f.household], ['הכניסו תנועות', f.tx], ['העלו פירוט', f.import], ['חזרו אחרי שבוע', f.cameBack]].map(([label, n]) => html`<div style="display:flex;align-items:center;gap:8px;font-size:13px">
          <span style="width:110px">${label}</span>
          <span style="flex:1;height:8px;background:var(--line);border-radius:4px;overflow:hidden"><i style=${'display:block;height:100%;background:var(--accent);width:' + (f.signups ? Math.round((n / f.signups) * 100) : 0) + '%'}></i></span>
          <b class="num" style="width:60px;text-align:end">${n} <span class="faint" style="font-weight:400">${pct(n)}</span></b></div>`)}
        ${f.oldEnough === 0 && html`<span class="faint" style="font-size:11px">"חזרו אחרי שבוע" נספר רק למי שנרשם לפני יותר משבוע.</span>`}
      </div>`}
      <div class="card stack"><b>חזרו אחרי שבוע</b>
        <span class="muted" style="font-size:14px">${s.retention.pct === null ? 'עוד אין מספיק נתונים.' : html`<b class="num">${s.retention.pct}%</b> (${s.retention.cameBack} מתוך ${s.retention.started} שהתחילו לפני 8–60 יום)`}</span>
        <span class="faint" style="font-size:12px">נרשמו: <span class="num">${s.signedUp ?? s.members}</span> · עם משק בית: <span class="num">${s.members}</span></span></div>
      <div class="card stack"><b>מה משתמשים (30 יום)</b>
        ${s.use.length === 0 ? html`<span class="muted">עוד אין.</span>` : s.use.map((u) => html`<div style="display:flex;justify-content:space-between"><span>${NAMES[u.name] || u.name}</span><b class="num">${u.count}</b></div>`)}</div>
      ${s.users && html`<div class="card stack per-user"><b>פעילות לפי משתמש (30 יום)</b>
        <span class="faint" style="font-size:12px;line-height:1.5">כל משתמש מסומן בקוד, בלי שם או אימייל, ובלי שום תוכן שכתבו. החשבונות שלך מסומנים ב-👑. עלות AI משוערת החודש: <b class="num">$${s.aiCost30d}</b>${s.systemCost30d ? ' (מתוכם $' + s.systemCost30d + ' משימות מערכת: חדשות, דוחות)' : ''}.</span>
        <div style="overflow-x:auto"><table class="num" style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap">
          <thead><tr>${['משתמש', 'הצטרף', 'נראה', 'פתיחות', 'הוספות', 'ייבוא', 'נכשלו', 'שאלות', 'קריאות AI', 'טוקנים', '$'].map((h) => html`<th style="text-align:start;padding:4px 6px;border-bottom:1px solid var(--line)">${h}</th>`)}</tr></thead>
          <tbody>${s.users.map((u) => html`<tr class=${u.owner ? 'owner-row' : ''} style=${u.owner ? 'background:color-mix(in srgb, var(--accent) 14%, transparent)' : ''}>${[u.owner ? '👑 ' + u.who + ' (אתה)' : u.who, u.joined ? u.joined.slice(5).split('-').reverse().join('.') : '', u.lastSeen ? u.lastSeen.slice(5).split('-').reverse().join('.') : '—', u.opens, u.added, u.imports, u.importFails || '', u.asked, u.aiCalls, u.tokens.toLocaleString('he-IL'), u.cost ? u.cost.toFixed(3) : ''].map((v) => html`<td style="padding:4px 6px;border-bottom:1px solid var(--line)">${v}</td>`)}</tr>`)}</tbody>
        </table></div></div>`}
      <div class="card stack"><b>תקלות השבוע: <span class="num">${s.errors.week}</span></b>
        ${s.errors.top.map((e) => html`<div style="font-size:13px"><b class="num">${e.count}×</b> ${e.message}<div class="faint" style="font-size:11px">${e.path || ''}</div></div>`)}</div>`}
  </div>`;
}
