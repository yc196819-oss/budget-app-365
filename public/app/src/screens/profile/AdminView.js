import { html } from '../../lib/html.js';
import { Icon } from '../../components/Icon.js';
import { useEffect, useState } from 'preact/hooks';
import { adminStats, adminLive, adminReengage, sendReengage, testMonthlyMail, sendMonthlyMail, priceReach, priceService, priceSample, priceRun } from '../../data/account.js';
import { InboxView } from './InboxView.js';
import { TodayCard, PeopleCard } from './PeopleView.js';
import { showToast } from '../../lib/toast.js';

const SCREEN_NAMES = { home: 'בית', money: 'כסף', together: 'ביחד', shop: 'קניות', plans: 'יעדים', assets: 'נכסים', login: 'כניסה', onboarding: 'הרשמה', other: 'אחר' };
const NAMES = { app_open: 'פתיחות', tx_add: 'הוספת תנועה', import_done: 'ייבוא', advisor_ask: 'שאלות ליועץ', advisor_talk: 'שיחה קולית', decision_open: 'החלטה חדשה', decision_message: 'הודעות ביחד', trip_plan: 'תכנון טיול', news_open: 'חדשות', lesson_done: 'שיעור', shortcut: 'קיצור דרך', export: 'ייצוא', restore: 'שחזור', import_fail: 'ייבוא שנכשל', guide_step: 'צעד במסלול התחלה', guide_skip: 'דילוג במסלול', learn_auto: 'עדכון אוטומטי מהיועץ', learn_undo: 'ביטול עדכון של היועץ', onboard_0: 'הרשמה: מסך פתיחה', onboard_1: 'הרשמה: מי אתם', onboard_2: 'הרשמה: מה רלוונטי', onboard_3: 'הרשמה: כרטיסים', onboard_4: 'הרשמה: הכנסה', onboard_5: 'הרשמה: פרטיות', onboard_done: 'הרשמה הושלמה' };

// "(of which $x yours, $y system tasks)" under the AI cost.
function costParts(s) {
  const parts = [s.ownerCost30d ? '$' + s.ownerCost30d + ' שלך' : '', s.systemCost30d ? '$' + s.systemCost30d + ' משימות מערכת: חדשות, דוחות' : ''].filter(Boolean);
  return parts.length ? ' (מתוכם ' + parts.join(', ') + ')' : '';
}

// The fixed words from the app, in Hebrew, for the upload numbers.
const FAIL_WHY = { ai_off: 'ה-AI כבוי אצלם', excel: 'אקסל שלא נפתח', password: 'אקסל נעול בסיסמה', xls: 'אקסל ישן שלא נפתח', type: 'סוג קובץ לא נתמך', empty: 'קובץ ריק', pdf_scan: 'PDF סרוק בלי טקסט', image_big: 'תמונה גדולה מדי', no_rows: 'לא נמצאו תנועות', junk: 'לא נראה כמו פירוט', other: 'תקלה אחרת' };
const LEFT_AT = { pick: 'לפני שבחרו קובץ', work: 'בזמן הקריאה', review: 'במסך הבדיקה, לפני שמירה', error: 'אחרי שגיאה' };
const FILE_KIND = { xlsx: 'אקסל', xls: 'אקסל ישן', csv: 'CSV', pdf: 'PDF', image: 'צילום', other: 'אחר' };
const dmy = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7);

// By week of sign-up: how far each group got. The number that matters most.
function CohortCard({ rows }) {
  if (!rows || !rows.length) return null;
  const pct = (n, of) => (of ? Math.round((n / of) * 100) + '%' : '–');
  return html`<div class="card stack admin-cohorts"><b>לפי שבוע הרשמה</b>
    <span class="faint" style="font-size:12px;line-height:1.5">כמה נרשמו בכל שבוע, וכמה מהם הגיעו לכל שלב. "חזרו" נספר רק למי שנרשם לפני יותר מ-8 ימים.</span>
    <div style="overflow-x:auto"><table class="admin-table">
      <thead><tr><th>שבוע</th><th>נרשמו</th><th>משק בית</th><th>יש נתונים</th><th>העלו</th><th>חזרו אחרי שבוע</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr key=${r.week}><td>${dmy(r.week)}</td><td class="num">${r.signups}</td><td class="num">${r.household}</td>
        <td class="num">${r.withData} <span class="faint">${pct(r.withData, r.signups)}</span></td><td class="num">${r.imported}</td>
        <td class="num">${r.oldEnough ? html`${r.cameBack} <span class="faint">${pct(r.cameBack, r.oldEnough)}</span>` : html`<span class="faint">מוקדם</span>`}</td></tr>`)}</tbody>
    </table></div>
  </div>`;
}

// Where uploads stop (30 days).
function UploadCard({ u }) {
  if (!u || !u.opened) return html`<div class="card stack admin-upload"><b>איפה נעצרים בהעלאה</b><span class="muted" style="font-size:13px">עוד אין נתונים. המדידה התחילה עכשיו, והמספרים יופיעו כשאנשים יעלו קבצים.</span></div>`;
  const list = (items, names) => items.map((x) => html`<div key=${x.key} style="display:flex;justify-content:space-between;font-size:13px"><span>${names[x.key] || x.key}</span><b class="num">${x.n}</b></div>`);
  return html`<div class="card stack admin-upload"><b>איפה נעצרים בהעלאה (30 יום)</b>
    <span style="font-size:14px">פתחו העלאה <b class="num">${u.opened}</b> · בחרו קובץ <b class="num">${u.picked}</b> · שמרו <b class="num">${u.saved}</b>${u.failedPeople ? html` · <span style="color:var(--danger)">נכשלו ${u.failedPeople}</span>` : ''}</span>
    ${u.reasons.length > 0 && html`<span class="faint" style="font-size:12px">למה נכשל</span>${list(u.reasons, FAIL_WHY)}`}
    ${u.leftAt.length > 0 && html`<span class="faint" style="font-size:12px">יצאו באמצע</span>${list(u.leftAt, LEFT_AT)}`}
    ${u.files.length > 0 && html`<span class="faint" style="font-size:12px">סוגי קבצים</span>${list(u.files, FILE_KIND)}`}
  </div>`;
}

// The owner's dashboard: who uses the app, who came back, what broke.
// The monthly summary email: see it in your own inbox, then send it to all.
function MonthlyMailCard() {
  const [busy, setBusy] = useState('');
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState('');
  const run = async (key, fn, done) => {
    setBusy(key); setNote('');
    try { setNote(done(await fn())); } catch (e) { setNote(e.message || 'לא נשלח. נסו שוב.'); }
    setBusy(''); setSure(false);
  };
  return html`<div class="card stack admin-monthly"><b>סיכום חודשי במייל</b>
    <span class="muted" style="font-size:13px;line-height:1.55">נשלח לבד ב-1 לכל חודש, יחד עם הדוח החודשי, רק למי שאישר באפליקציה שהוא רוצה. כל אחד מקבל כל חודש פעם אחת, ויכול להסיר את עצמו בלחיצה מהמייל או בפרופיל.</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 12px" disabled=${!!busy} onClick=${() => run('t', testMonthlyMail, (r) => 'נשלח אליך הסיכום של ' + r.month + ', עם המספרים של משק הבית שלך.')}>${busy === 't' ? 'שולח…' : 'ניסיון אליי'}</button>
      <button type="button" class=${'btn' + (sure ? '' : ' btn-ghost')} style="width:auto;padding:6px 12px" disabled=${!!busy} onClick=${() => (sure ? run('s', sendMonthlyMail, (r) => 'נשלחו ' + r.sent + ' מיילים (' + (r.month || '') + ').') : setSure(true))}>${busy === 's' ? 'שולח…' : sure ? 'בטוח? לשלוח לכולם' : 'לשלוח עכשיו את החודש האחרון'}</button>
    </div>
    ${note && html`<span role="status" style="font-size:13px">${note}</span>`}
  </div>`;
}

// Supermarket prices: which chains' price sites answer our server. Some
// block visitors from abroad, and our server is abroad.
function PriceReachCard() {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState(null);
  const run = async () => { setBusy(true); try { setR(await priceReach()); } catch (e) { setR({ error: e.message || 'הבדיקה נכשלה' }); } setBusy(false); };
  const why = (x) => (x.ok ? 'עונה' : x.status === 403 ? 'חוסם (כנראה כי השרת בחו"ל)' : x.error === 'timeout' ? 'לא ענה בזמן' : x.status ? 'שגיאה ' + x.status : 'לא נגיש');
  return html`<div class="card stack admin-prices"><b>מחירי סופר: אילו רשתות נגישות מהשרת</b>
    <span class="muted" style="font-size:13px;line-height:1.55">בודק עכשיו, מהשרת שלנו, אם האתרים שבהם הרשתות מפרסמות מחירים עונים. לא נשמר כלום.</span>
    <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 12px" disabled=${busy} onClick=${run}>${busy ? 'בודק…' : 'לבדוק עכשיו'}</button>
    ${r && r.error && html`<span role="status" style="font-size:13px">${r.error}</span>`}
    ${r && r.sites && html`<div role="status" class="stack" style="gap:4px;font-size:13px">
      <span>${r.sites.filter((x) => x.ok).length} מתוך ${r.sites.length} עונים</span>
      ${r.sites.map((x) => html`<span key=${x.key}><b style=${'color:' + (x.ok ? 'var(--accent)' : 'var(--danger)')}>${x.ok ? '✓' : '✕'}</b> ${x.name}: ${why(x)}</span>`)}
    </div>`}
  </div>`;
}

// The outside price service: first what it is and costs, then one small run
// to see real rows (chain, store, product, price, when updated).
function PriceServiceCard() {
  const [about, setAbout] = useState(null);
  const [sample, setSample] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (key, fn, set) => { setBusy(key); setErr(''); try { set(await fn()); } catch (e) { setErr(e.message || 'הבדיקה נכשלה'); } setBusy(''); };
  const [wait, setWait] = useState(0);
  // Start the run, then check every 5 seconds (up to 5 minutes) until it ends.
  const runSample = async () => {
    setSample(null); setWait(0);
    const start = await priceSample();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const r = await priceRun(start.runId);
      setWait(r.seconds || (i + 1) * 5);
      if (r.done) {
        if (r.status !== 'SUCCEEDED') throw new Error('ההרצה הסתיימה בלי תוצאות (' + r.status + ')');
        return { ...r, input: start.input };
      }
    }
    throw new Error('ההרצה לוקחת יותר מ-5 דקות. אפשר לנסות שוב מאוחר יותר.');
  };
  const p = about && about.pricing;
  return html`<div class="card stack admin-price-service"><b>מחירי סופר: השירות החיצוני (Apify)</b>
    <span class="muted" style="font-size:13px;line-height:1.55">שלב 1: מה השירות מבקש ומה הוא עולה (בחינם). שלב 2: הרצה קטנה אחת (חלב 3%, סניף אחד מכל רשת, עד 15 תוצאות) כדי לראות מחירים אמיתיים. ההרצה משתמשת בקצת מהקרדיט החודשי.</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 12px" disabled=${!!busy} onClick=${() => run('a', priceService, setAbout)}>${busy === 'a' ? 'בודק…' : '1. מה השירות'}</button>
      <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 12px" disabled=${!!busy} onClick=${() => run('s', runSample, setSample)}>${busy === 's' ? 'מריץ… ' + (wait ? wait + ' שניות' : '') : '2. הרצה קטנה'}</button>
    </div>
    ${err && html`<span role="status" style="font-size:13px;color:var(--danger)">${err}</span>`}
    ${about && html`<div role="status" class="stack" style="gap:4px;font-size:13px">
      <span><b>${about.title}</b>${about.modified ? ' · עודכן ' + String(about.modified).slice(0, 10) : ''}</span>
      ${about.description && html`<span class="muted">${about.description}</span>`}
      <span>מחיר: ${p ? (p.model || '') + (p.perUnit != null ? ' · $' + p.perUnit + ' ל-' + (p.unit || 'יחידה') : '') + (p.events ? ' · ' + JSON.stringify(p.events).slice(0, 160) : '') : 'לא צוין'}</span>
      ${about.fields.length > 0 && html`<span class="faint">שדות שהוא מקבל:</span>${about.fields.map((f) => html`<span key=${f.key} dir="auto"><bdi>${f.key}</bdi>${f.title ? ' – ' + f.title : ''}${f.example !== undefined ? ' (למשל ' + JSON.stringify(f.example).slice(0, 60) + ')' : ''}</span>`)}`}
    </div>`}
    ${sample && html`<div role="status" class="stack" style="gap:4px;font-size:13px">
      <span>${sample.count} תוצאות ב-${sample.seconds} שניות${sample.cost != null ? ' · עלה $' + Number(sample.cost).toFixed(3) : ''}${sample.input && sample.input.productQueries ? ' · חיפוש: ' + sample.input.productQueries.join(', ') : ''}</span>
      <span class="faint" dir="auto">שדות: ${sample.keys.join(', ')}</span>
      <div style="overflow-x:auto"><table class="admin-table" dir="auto"><thead><tr>${sample.keys.slice(0, 8).map((k) => html`<th key=${k}>${k}</th>`)}</tr></thead>
        <tbody>${sample.rows.map((r, i) => html`<tr key=${i}>${sample.keys.slice(0, 8).map((k) => html`<td key=${k}>${r[k] ?? ''}</td>`)}</tr>`)}</tbody></table></div>
    </div>`}
  </div>`;
}

// The four numbers at the top, and one plain sentence, from what the
// dashboard already has. No AI: free and always the same for the same numbers.
export function adminKpis(s) {
  const daily = s.daily || [];
  const today = daily[daily.length - 1] || { active: 0, cost: 0 };
  const yesterday = daily[daily.length - 2];
  const diff = yesterday ? today.active - yesterday.active : null;
  const byDay = (s.funnel && s.funnel.byDay) || {};
  const week = daily.slice(-7).reduce((n, d) => n + (Number(byDay[d.day]) || 0), 0);
  const c = (s.cohorts || [])[0];
  const u = s.upload;
  const tiles = [
    { label: 'פעילים היום', value: s.active.day, note: diff == null ? '' : diff === 0 ? 'כמו אתמול' : (diff > 0 ? '▲ ' : '▼ ') + Math.abs(diff) + ' מאתמול', tone: diff > 0 ? 'up' : diff < 0 ? 'down' : '' },
    { label: 'נרשמו השבוע', value: week, note: s.sharing && s.sharing.friends ? s.sharing.friends + ' מחבר (סה"כ)' : '' },
    { label: 'חזרו אחרי שבוע', value: s.retention && s.retention.pct != null ? s.retention.pct + '%' : '–', note: s.retention && s.retention.started ? s.retention.cameBack + ' מתוך ' + s.retention.started : '' },
    { label: 'עלות AI היום', value: '$' + (Number(today.cost) || 0).toFixed(2), note: '$' + (s.aiCost30d ?? 0) + ' ב-30 יום' }
  ];
  const parts = [];
  if (c) parts.push('השבוע נרשמו ' + c.signups + (c.signups ? ', ' + c.withData + ' מהם כבר עם נתונים' : ''));
  if (u && u.failedPeople) parts.push(u.failedPeople + ' נכשלו בהעלאה ב-30 יום');
  parts.push(s.active.day + ' פעילים היום');
  return { tiles, summary: parts.join('. ') + '.' };
}

export function AdminView({ onBack }) {
  const [s, setS] = useState(undefined);
  const [live, setLive] = useState(null);
  useEffect(() => { adminStats().then((x) => { setS(x); if (x && x.live) setLive(x.live); }); }, []);
  // The live count refreshes every 15 seconds while the dashboard is open.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') adminLive().then((l) => l && setLive(l)); }, 15000);
    return () => clearInterval(t);
  }, []);
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
      <div class="mail-fly" aria-hidden="true"><span class="mail-env"><${Icon} name="mail" size=${20} /></span><span class="mail-trail"></span></div>
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
  const today = s && s.daily ? s.daily[s.daily.length - 1] : null;
  const f = s && s.funnel;
  const pct = (n) => (f && f.signups ? Math.round((n / f.signups) * 100) + '%' : '');
  // On a computer everything is spread on one page; on a phone, a main screen
  // with buttons, each opening its own page.
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const m = matchMedia('(min-width: 1024px)');
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const [section, setSection] = useState(null);
  const k = s ? adminKpis(s) : null;
  const sections = [
    { key: 'inbox', icon: 'chat', title: 'פניות', sub: 'פניות ותשובות, ומה קרה היום', body: () => html`<${TodayCard} /><${InboxView} />` },
    { key: 'activity', icon: 'chart', title: 'פעילות ומשתמשים', sub: 'גרף, לפי שבוע הרשמה, איפה נעצרים, מי משתמש', body: () => html`
    ${live && html`<div class="card stack admin-live" role="status">
      <span style="display:flex;align-items:baseline;gap:10px"><span aria-hidden="true" style="width:10px;height:10px;border-radius:5px;background:var(--income);display:inline-block"></span>
        <b style="font-size:17px">מחוברים עכשיו: <span class="num">${live.users}</span></b>
        <span class="muted" style="font-size:13px">${live.visitors ? '+ ' + live.visitors + ' לא מחוברים (במסך הכניסה)' : ''}</span></span>
      ${live.users + live.visitors > 0 && html`<span class="muted" style="font-size:13px">${Object.entries(live.screens).map(([k, n]) => (SCREEN_NAMES[k] || k) + ' ' + n).join(' · ')}</span>
        <span class="faint" style="font-size:12px">טלפון ${live.devices.mobile} · מחשב ${live.devices.desktop} · מותקנת ${live.installed}</span>`}
      <span class="faint" style="font-size:11px">מתעדכן כל 15 שניות. נספר מי שהאפליקציה פתוחה אצלו ב-2 הדקות האחרונות.</span>
    </div>`}
    ${s && html`
      <div class="card admin-counts"><span>פעילים: היום <b class="num">${s.active.day}</b> · השבוע <b class="num">${s.active.week}</b> · החודש <b class="num">${s.active.month}</b></span>${today && html`<span>נרשמו היום <b class="num">${(f && f.byDay && f.byDay[today.day]) || 0}</b></span>`}</div>
      ${s.daily && html`<div class="card stack admin-daily"><b>14 הימים האחרונים</b>
        <div style="display:flex;align-items:flex-end;gap:4px;height:90px" aria-label="פעילים לפי יום">
          ${s.daily.map((d) => { const top = Math.max(1, ...s.daily.map((x) => x.active)); return html`<div title=${d.day + ': ' + d.active + ' פעילים, $' + d.cost} style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;justify-content:flex-end;height:100%">
            <span class="num faint" style="font-size:10px">${d.active || ''}</span>
            <i style=${'display:block;width:100%;border-radius:3px 3px 0 0;background:var(--accent);height:' + Math.max(2, Math.round((d.active / top) * 70)) + 'px'}></i>
            <span class="num faint" style="font-size:9px">${Number(d.day.slice(8))}</span></div>`; })}
        </div><span class="faint" style="font-size:11px">גובה = משתמשים פעילים ביום. מעבר עם העכבר מראה גם את עלות ה-AI.</span></div>`}
      <${CohortCard} rows=${s.cohorts} />
      <${UploadCard} u=${s.upload} />
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
      ${s.users && html`<${PeopleCard} users=${s.users} aiCost=${s.aiCost30d} costNote=${costParts(s)} sharing=${s.sharing} />`}
`}` },
    { key: 'mail', icon: 'mail', title: 'מיילים', sub: 'מיילי עזרה וסיכום חודשי', body: () => html`
    ${back && back.campaigns && html`<div class="card stack admin-reengage"><b>מיילים למשתמשים</b>
      <span class="muted" style="font-size:13px;line-height:1.55">כל מייל נשלח לכל אדם פעם אחת בלבד, ורק כשלוחצים כאן פעמיים. קודם כדאי לשלוח ניסיון לעצמכם. בתחתית כל מייל יש "להסרה לחץ כאן", ומי שלחץ עליו לא יקבל יותר אף אחד מהם.</span>
      <span class="campaign-stopped" style="font-size:13px">ביקשו להפסיק לקבל: <b class="num">${back.stopped || 0}</b></span>
      <span class="faint" style="font-size:12px;line-height:1.5">"נשלח" אומר שהשרת מסר את המייל ל-Brevo. אם הוא הגיע ונפתח רואים ב-Brevo: Transactional ← Logs.</span>
      ${back.mail && !back.mail.ready && html`<span class="card mail-not-ready" role="status" style="font-size:13px;line-height:1.55;border:1px solid var(--danger)">השרת עוד לא מוגדר לשלוח מיילים למשתמשים${back.mail.resendTestOnly ? ' (Resend מוגדר רק בכתובת הניסיון שלו, שמגיעה רק אליכם)' : ''}. צריך לחבר את Brevo (חינם): BREVO_API_KEY ו-BREVO_FROM בהגדרות השרת ב-Render.</span>`}
      ${back.campaigns.map((c) => html`<div class=${'campaign campaign-' + c.id} key=${c.id} style="display:flex;flex-direction:column;gap:6px;padding:8px 0;border-top:1px solid var(--line)">
        <span style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px">${c.title}</b><b class="num">${c.count}</b></span>
        ${c.done && (c.done.sent > 0 || c.done.failed > 0) && html`<span class="campaign-done muted" style="font-size:13px">נשלח ל-${c.done.sent}${c.done.failed ? html` · <span style="color:var(--danger)">נכשל ${c.done.failed}</span>` : ' · לא נכשל אף אחד'}${c.done.last ? ' · אחרון ' + String(c.done.last).slice(5, 10).split('-').reverse().join('.') : ''}</span>`}
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
    ${back && html`<${MonthlyMailCard} />`}` },
    { key: 'prices', icon: 'cart', title: 'מחירי סופר', sub: 'אילו רשתות עונות, והשירות החיצוני', body: () => html`${back && html`<${PriceReachCard} />`}${back && html`<${PriceServiceCard} />`}` },
    { key: 'system', icon: 'wrench', title: 'מצב המערכת', sub: s ? 'תקלות השבוע: ' + s.errors.week : 'תקלות ומה שבור', body: () => html`${s && html`
      <div class="card stack"><b>תקלות השבוע: <span class="num">${s.errors.week}</span></b>
        ${s.errors.top.map((e) => html`<div style="font-size:13px"><b class="num">${e.count}×</b> ${e.message}<div class="faint" style="font-size:11px">${e.path || ''}</div></div>`)}</div>`}` }
  ];
  const open = sections.find((x) => x.key === section);
  return html`<div class=${'stack admin-stats' + (wide ? ' admin-wide' : '')}>
    <div class="admin-top">
      ${open && !wide ? html`<button type="button" class="btn-text" onClick=${() => setSection(null)}>→ לוח הבעלים</button>`
        : html`<button type="button" class="btn-text" onClick=${onBack}>→ חזרה</button>`}
      ${live && html`<span class="admin-pill" role="status"><span class="admin-dot" aria-hidden="true"></span><b class="num">${live.users}</b> עכשיו</span>`}
    </div>
    ${s === undefined && html`<span class="muted">טוען…</span>`}
    ${s === null && html`<span class="muted">הנתונים לא זמינים כרגע.</span>`}
    ${(!open || wide) && k && html`
      <div class="card admin-summary"><span class="admin-spark" aria-hidden="true"><${Icon} name="spark" size=${16} /></span><span>${k.summary}</span></div>
      <div class="admin-kpis">
        ${k.tiles.map((t) => html`<div class="card admin-kpi" key=${t.label}><span class="muted">${t.label}</span><b class="num">${t.value}</b>${t.note && html`<span class=${'admin-chg ' + (t.tone || '')}>${t.note}</span>`}</div>`)}
      </div>`}
    ${!wide && !open && html`<nav class="admin-hub" aria-label="חלקי לוח הבעלים">
      ${sections.map((x) => html`<button type="button" class="card admin-hub-btn" key=${x.key} onClick=${() => setSection(x.key)}>
        <span class="admin-hub-ic"><${Icon} name=${x.icon} size=${18} /></span><span class="admin-hub-t"><b>${x.title}</b><small>${x.sub}</small></span><span aria-hidden="true">‹</span></button>`)}
    </nav>`}
    ${!wide && open && html`<h3 class="admin-sec-title">${open.title}</h3><div class="stack">${open.body()}</div>`}
    ${wide && html`<div class="admin-grid">${sections.map((x) => html`<section class=${'admin-sec admin-sec-' + x.key} key=${x.key} aria-labelledby=${'adm-' + x.key}>
      <h3 class="admin-sec-title" id=${'adm-' + x.key}>${x.title}</h3><div class="stack">${x.body()}</div></section>`)}</div>`}
  </div>`;
}
