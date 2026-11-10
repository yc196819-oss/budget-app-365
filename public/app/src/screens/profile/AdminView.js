import { html } from '../../lib/html.js';
import { Icon } from '../../components/Icon.js';
import { useEffect, useState } from 'preact/hooks';
import { adminStats, adminLive, adminAsk, adminReengage, sendReengage, testMonthlyMail, sendMonthlyMail, priceReach, priceService, priceSample, priceRun } from '../../data/account.js';
import { InboxView } from './InboxView.js';
import { TodayCard, PeopleCard } from './PeopleView.js';
import { showToast } from '../../lib/toast.js';
import { greeting, ago, areas, record } from '../../domain/admin.js';
import { loadStart, loadState, kosherList, kosherConfirm } from '../../data/prices.js';
import { kosherHint, LEVEL_NAMES, size, sizeText } from '../../domain/prices.js';

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

// The catalog, loaded on the server part by part (what most families buy,
// then what families looked for and did not find). It goes on when this
// screen is closed; the card shows where it is, from the database itself.
function SeedCard() {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let on = true;
    const tick = async () => {
      const x = await loadState().catch(() => null);
      if (!on) return;
      if (x) setSt(x);
      setTimeout(() => { if (on) tick(); }, x && x.running ? 5000 : 30000);
    };
    tick();
    return () => { on = false; };
  }, []);
  const start = async () => { setErr(''); try { setSt(await loadStart()); } catch (e) { setErr(e.message || 'לא התחיל.'); } };
  return html`<div class="card stack price-seed"><b>קטלוג המוצרים שלנו</b>
    <span class="muted" style="font-size:13px;line-height:1.55">משפחות מקבלות מחירים מיד, מתוך הקטלוג הזה. מה שחיפשו ולא היה בו נרשם, ונטען בטעינה הבאה. הטעינה רצה בשרת: אפשר לסגור את המסך. כל חלק עולה כמה סנטים מהקרדיט של Apify.</span>
    ${st && html`<div class="price-seed-stats" role="status">
      <span><b class="num">${st.products}</b><small class="muted">מוצרים</small></span>
      <span><b class="num">${st.offers}</b><small class="muted">מחירים</small></span>
      <span><b class="num">${st.chains}</b><small class="muted">רשתות</small></span>
      <span><b class="num">${st.wanted}</b><small class="muted">חיפשו ולא נמצאו</small></span>
    </div>`}
    ${st && st.running && html`<div class="price-seed-run"><span class="price-seed-bar"><i style=${'width:' + Math.round(((st.part - 0.5) / Math.max(1, st.parts)) * 100) + '%'}></i></span>
      <span role="status">טוען חלק ${st.part} מתוך ${st.parts}… נוספו עד עכשיו ${st.added} מוצרים</span></div>`}
    ${st && !st.running && st.endedAt && html`<span class="muted" style="font-size:13px">הטעינה האחרונה הסתיימה: נוספו ${st.added} מוצרים${st.cost ? ' · עלות $' + Number(st.cost).toFixed(2) : ''}.</span>`}
    ${st && st.error && html`<span role="alert" style="color:var(--danger)">${st.error}</span>`}
    ${err && html`<span role="alert" style="color:var(--danger)">${err}</span>`}
    ${st && !st.running && st.estimate != null && html`<span class="muted" style="font-size:13px">טעינה מלאה: כל מוצר נבדק ב-${st.mainChains || 10} הרשתות הגדולות, כדי להשוות את אותו מוצר בדיוק. עלות משוערת: עד $${Number(st.estimate).toFixed(2)}.</span>`}
    ${!(st && st.running) && html`<button type="button" class="btn btn-ghost" style="width:auto" onClick=${start}>${st && st.products ? 'לעדכן ולהשלים את הקטלוג' : 'לטעון את הקטלוג הראשון'}</button>`}
  </div>`;
}

// Products waiting for a kashrut word. The owner's word counts as confirmed;
// names that say "מהדרין" are marked so a whole group can be confirmed at once.
function KosherCard() {
  const [d, setD] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const load = (text = q) => kosherList(text).then((x) => { setD(x); setSel(new Set()); }).catch(() => setD(null));
  const confirm = async (codes, level) => {
    if (!codes.length) return;
    try { await kosherConfirm(codes, level); showToast('נשמר: ' + codes.length + ' מוצרים, ' + LEVEL_NAMES[level]); load(); } catch (err) { showToast(err.message || 'לא נשמר.'); }
  };
  // Opened on request, so the dashboard does not ask for it every time.
  if (d === false) return html`<div class="card stack kosher-admin"><b>אישור כשרות</b><span class="muted" style="font-size:13px">מוצרים בקטלוג שעוד לא אישרתם את הכשרות שלהם.</span><button type="button" class="btn btn-ghost" style="width:auto" onClick=${() => { setD(undefined); load(''); }}>להציג מוצרים שמחכים לאישור</button></div>`;
  if (d === undefined) return html`<div class="card"><span class="muted">טוען…</span></div>`;
  if (d === null) return html`<div class="card"><span class="muted">רשימת הכשרות לא זמינה כרגע.</span></div>`;
  const hinted = d.waiting.filter((p) => kosherHint(p.name) === 'mehadrin').map((p) => p.barcode);
  const toggle = (c) => setSel((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  return html`<div class="card stack kosher-admin"><b>אישור כשרות</b>
    <span class="muted" style="font-size:13px;line-height:1.55">${d.products} מוצרים בקטלוג · ${d.confirmed} אושרו על ידיכם. מוצר שלא אושר לא נבחר לבד למשפחה שביקשה כשרות. האישור שלכם נחשב מאושר.</span>
    <form style="display:flex;gap:8px" onSubmit=${(e) => { e.preventDefault(); load(q); }}><input class="input" value=${q} placeholder="לחפש: חלב, תנובה…" aria-label="חיפוש מוצר" onInput=${(e) => setQ(e.currentTarget.value)} style="flex:1;min-width:0" /><button class="btn btn-ghost" style="width:auto">לחפש</button></form>
    ${hinted.length > 0 && html`<button type="button" class="btn btn-ghost" onClick=${() => confirm(hinted, 'mehadrin')}>לאשר כמהדרין את ${hinted.length} שכתוב בשמם "מהדרין"</button>`}
    ${d.waiting.length === 0 ? html`<span class="muted">אין מוצרים שמחכים.</span>` : html`<ul class="kosher-list">${d.waiting.map((p) => html`<li key=${p.barcode}>
      <label><input type="checkbox" checked=${sel.has(p.barcode)} onChange=${() => toggle(p.barcode)} /><span><b>${p.name}</b><small class="muted">${[p.maker, sizeText(size(p.qty, p.unit)), p.barcode].filter(Boolean).join(' · ')}</small></span></label>
      ${kosherHint(p.name) && html`<span class="kosher kosher-unknown">בשם: ${kosherHint(p.name) === 'mehadrin' ? 'מהדרין' : 'כשר'}</span>`}</li>`)}</ul>`}
    ${sel.size > 0 && html`<div class="kosher-bar">${['mehadrin', 'regular', 'none'].map((l) => html`<button type="button" class="btn btn-ghost" key=${l} style="width:auto" onClick=${() => confirm([...sel], l)}>${LEVEL_NAMES[l]} (${sel.size})</button>`)}</div>`}
  </div>`;
}

// A number that counts up to its value when it first shows ("$4.24", "15%"
// keep their sign). Still for whoever asked their device for less motion.
function CountUp({ value }) {
  const m = /^(\D*)(\d+(?:\.\d+)?)(\D*)$/.exec(String(value));
  const [shown, setShown] = useState(() => (m ? m[1] + (0).toFixed((m[2].split('.')[1] || '').length) + m[3] : String(value)));
  useEffect(() => {
    if (!m) { setShown(String(value)); return undefined; }
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const to = Number(m[2]);
    const dec = (m[2].split('.')[1] || '').length;
    if (still || !to) { setShown(String(value)); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      setShown(m[1] + (to * (1 - Math.pow(1 - p, 3))).toFixed(dec) + m[3]);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return html`<b class="num">${shown}</b>`;
}

// A small line of the last days under a number; draws itself.
function Spark({ values }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  // Right to left, like the daily chart: today at the left end.
  const pts = values.map((v, i) => [Math.round(200 - (i / (values.length - 1)) * 200), Math.round(34 - (v / max) * 30)]);
  const d = pts.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join(' ');
  return html`<svg class="admin-spark-line" viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true">
    <path class="area" d=${d + ' L0 36 L200 36Z'} /><path class="line" d=${d} pathLength="100" /></svg>`;
}

// Today the busiest day of the month (or of two weeks): a small celebration.
function Record({ daily }) {
  const r = record(daily || []);
  if (!r) return null;
  const month = r.span === 'month';
  return html`<div class=${'card admin-record' + (month ? ' is-month' : '')} role="status">
    <span class="admin-confetti" aria-hidden="true">${Array.from({ length: month ? 28 : 18 }, (_, i) => html`<i key=${i} style=${'--i:' + i}></i>`)}</span>
    <span class="admin-trophy" aria-hidden="true"><${Icon} name="spark" size=${18} /></span>
    <span><b>${month ? 'שיא חודשי' : 'שיא של שבועיים'}: ${r.today} פעילים היום</b><br /><span class="muted">יותר מכל יום ב-${month ? '30' : '14'} הימים האחרונים.</span></span>
  </div>`;
}

// A question about the numbers, answered by the AI from totals only.
const ASK_EXAMPLES = ['כמה נרשמו השבוע לעומת שבוע שעבר?', 'איפה אנשים נתקעים בהעלאה?', 'מה הכי השתנה בחודש האחרון?'];
function AskCard({ s }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const ask = async (text) => {
    const t = String(text ?? q).trim();
    if (t.length < 3 || busy) return;
    setQ(t); setBusy(true); setAnswer(null);
    try { setAnswer({ q: t, text: (await adminAsk(t, s)).answer }); } catch (err) { setAnswer({ q: t, error: err.message || 'לא התקבלה תשובה. נסו שוב.' }); }
    setBusy(false);
  };
  return html`<div class="card stack admin-ask">
    <b class="admin-ask-title"><span class="admin-spark" aria-hidden="true"><${Icon} name="spark" size=${16} /></span>שאלו את הנתונים</b>
    <form class="admin-ask-row" onSubmit=${(e) => { e.preventDefault(); ask(); }}>
      <input class="input" value=${q} maxlength="400" placeholder="למשל: כמה מהנרשמים השבוע כבר העלו פירוט?" aria-label="שאלה על הנתונים" onInput=${(e) => setQ(e.currentTarget.value)} />
      <button type="submit" class="btn" style="width:auto" disabled=${busy || q.trim().length < 3}>${busy ? 'חושב…' : 'לשאול'}</button>
    </form>
    <div class="admin-ask-chips">${ASK_EXAMPLES.map((x) => html`<button type="button" class="chip" key=${x} disabled=${busy} onClick=${() => ask(x)}>${x}</button>`)}</div>
    ${busy && html`<div class="admin-ask-wait" role="status"><i></i><i></i><i></i><span class="sr-only">חושב…</span></div>`}
    ${answer && html`<div class=${'admin-ask-answer' + (answer.error ? ' is-error' : '')} role="status" aria-live="polite"><small class="faint">${answer.q}</small><p>${answer.error || answer.text}</p></div>`}
    <span class="faint" style="font-size:11.5px">נשלחים ל-AI רק סיכומים (מספרים לפי יום ושבוע), בלי שמות ובלי מיילים. כל שאלה עולה כסנט או שניים.</span>
  </div>`;
}

// What is happening right now: the last meaningful moments, newest first.
function FeedCard({ items, limit = 14 }) {
  if (!items) return null;
  const now = new Date();
  return html`<div class="card stack admin-feed"><b>מה קורה עכשיו</b>
    ${items.length === 0 ? html`<span class="muted">שקט ביומיים האחרונים.</span>` : html`<ol class="admin-feed-list">
      ${items.slice(0, limit).map((x, i) => html`<li key=${i} class=${'is-' + x.kind} style=${'--i:' + i}><span class="admin-feed-dot" aria-hidden="true"></span><span class="admin-feed-t"><b>${x.who}</b> ${x.what}</span><span class="faint admin-feed-when">${ago(x.at, now)}</span></li>`)}
    </ol>`}
  </div>`;
}

// Active people each day: two weeks or a month.
function DailyChart({ daily }) {
  const [span, setSpan] = useState(14);
  if (!daily || !daily.length) return null;
  const days = daily.slice(-span);
  const top = Math.max(1, ...days.map((x) => x.active));
  return html`<div class="card stack admin-daily">
    <span style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>${span === 14 ? '14 הימים האחרונים' : '30 הימים האחרונים'}</b>
      <span class="seg" role="group" aria-label="תקופה">${[14, 30].map((n) => html`<button type="button" key=${n} class=${'seg-btn' + (span === n ? ' on' : '')} aria-pressed=${span === n} onClick=${() => setSpan(n)}>${n === 14 ? 'שבועיים' : 'חודש'}</button>`)}</span></span>
    <div key=${span} style="display:flex;align-items:flex-end;gap:${span === 14 ? 4 : 2}px;height:90px" aria-label="פעילים לפי יום">
      ${days.map((d, i) => html`<div title=${d.day + ': ' + d.active + ' פעילים, $' + d.cost} style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;justify-content:flex-end;height:100%">
        ${span === 14 && html`<span class="num faint" style="font-size:10px">${d.active || ''}</span>`}
        <i class="admin-bar" style=${'display:block;width:100%;border-radius:3px 3px 0 0;background:var(--accent);height:' + Math.max(2, Math.round((d.active / top) * 70)) + 'px;animation-delay:' + (i * (span === 14 ? 35 : 18)) + 'ms'}></i>
        <span class="num faint" style="font-size:9px">${span === 14 || i % 5 === 0 || i === days.length - 1 ? Number(d.day.slice(8)) : ''}</span></div>`)}
    </div><span class="faint" style="font-size:11px">גובה = משתמשים פעילים ביום. מעבר עם העכבר מראה גם את עלות ה-AI.</span></div>`;
}

// Where people spend their actions (30 days): a ring that draws itself.
const AREA_COLORS = ['var(--accent)', 'var(--income)', '#7aa7e0', '#c98a3e', '#b07ad6', 'var(--danger)', 'var(--faint)'];
function UseDonut({ use }) {
  const a = areas(use || []);
  if (!a.length) return null;
  let at = 0;
  return html`<div class="card admin-donut"><b>איפה משתמשים (30 יום)</b>
    <div class="admin-donut-body">
      <svg viewBox="0 0 42 42" width="132" height="132" aria-hidden="true"><circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--line)" stroke-width="6" />
        ${a.map((x, i) => { const seg = html`<circle key=${x.key} class="admin-donut-seg" cx="21" cy="21" r="15.9" fill="none" stroke=${AREA_COLORS[i % AREA_COLORS.length]} stroke-width="6" pathLength="100" stroke-dasharray=${Math.max(0, x.pct - 0.6) + ' ' + (100 - Math.max(0, x.pct - 0.6))} stroke-dashoffset=${-at} style=${'animation-delay:' + i * 0.12 + 's'} />`; at += x.pct; return seg; })}
      </svg>
      <ul class="admin-donut-legend">${a.map((x, i) => html`<li key=${x.key}><i style=${'background:' + AREA_COLORS[i % AREA_COLORS.length]}></i>${x.label}<b class="num">${x.pct}%</b></li>`)}</ul>
    </div></div>`;
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
    { label: 'פעילים היום', value: s.active.day, series: daily.slice(-14).map((d) => d.active), note: diff == null ? '' : diff === 0 ? 'כמו אתמול' : (diff > 0 ? '▲ ' : '▼ ') + Math.abs(diff) + ' מאתמול', tone: diff > 0 ? 'up' : diff < 0 ? 'down' : '' },
    // "This week" is since Sunday, the same as the sentence below and the weekly table.
    { label: 'נרשמו השבוע', value: c ? c.signups : week, note: s.sharing && s.sharing.friends ? s.sharing.friends + ' מחבר (סה"כ)' : '' },
    { label: 'חזרו אחרי שבוע', value: s.retention && s.retention.pct != null ? s.retention.pct + '%' : '–', note: s.retention && s.retention.started ? s.retention.cameBack + ' מתוך ' + s.retention.started : '' },
    { label: 'עלות AI היום', value: '$' + (Number(today.cost) || 0).toFixed(2), series: daily.slice(-14).map((d) => Number(d.cost) || 0), note: '$' + (s.aiCost30d ?? 0) + ' ב-30 יום' }
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
    { key: 'ask', icon: 'spark', title: 'שאלו את הנתונים', sub: 'שאלה במילים, תשובה מה-AI', body: () => html`${s && html`<${AskCard} s=${s} />`}` },
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
      <${DailyChart} daily=${s.daily} />
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
      <${UseDonut} use=${s.use} />
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
    { key: 'prices', icon: 'cart', title: 'מחירי סופר', sub: 'קטלוג המוצרים, אישור כשרות, והשירות החיצוני', body: () => html`${back && html`<${SeedCard} />`}${back && html`<${KosherCard} />`}${back && html`<${PriceServiceCard} />`}${back && html`<${PriceReachCard} />`}` },
    { key: 'system', icon: 'wrench', title: 'מצב המערכת', sub: s ? 'תקלות השבוע: ' + s.errors.week : 'תקלות ומה שבור', body: () => html`${s && html`
      <div class="card stack"><b>תקלות השבוע: <span class="num">${s.errors.week}</span></b>
        ${s.errors.top.map((e) => html`<div style="font-size:13px"><b class="num">${e.count}×</b> ${e.message}<div class="faint" style="font-size:11px">${e.path || ''}</div></div>`)}</div>`}` }
  ];
  const open = sections.find((x) => x.key === section);
  const hi = greeting();
  // Which version the server runs, and since when: did the update go up?
  const [ver, setVer] = useState(null);
  useEffect(() => { fetch('/api/health').then((r) => r.json()).then(setVer).catch(() => setVer(null)); }, []);
  // On a computer and on a phone alike: a main screen (the numbers, what is
  // happening now) with a button for each part, and each part on its own
  // page with a way back. Only up-and-down scrolling, never sideways.
  const hub = wide ? sections.filter((x) => x.key !== 'ask') : sections;
  const openPart = (key) => { setSection(key); const el = document.querySelector('.sheet-body, .sheet'); if (el) el.scrollTop = 0; };
  return html`<div class=${'stack admin-stats' + (wide ? ' admin-wide' : '')}>
    <div class="admin-top">
      ${open ? html`<button type="button" class="btn-text" onClick=${() => setSection(null)}>→ לוח הבעלים</button>`
        : html`<button type="button" class="btn-text" onClick=${onBack}>→ חזרה</button>`}
      ${!open && html`<span class="admin-hello"><b>${hi.hello}</b><small class="muted">${hi.date}</small></span>`}
      ${live && html`<span class="admin-pill" role="status"><span class="admin-dot" aria-hidden="true"></span><b class="num">${live.users}</b> עכשיו</span>`}
    </div>
    ${s === undefined && html`<span class="muted">טוען…</span>`}
    ${!open && ver && html`<span class="admin-ver faint">גרסת השרת: <b class="num">${ver.version || 'לא ידוע'}</b>${ver.startedAt ? ' · עלה ' + new Date(ver.startedAt).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }) : ''}</span>`}
    ${s === null && html`<span class="muted">הנתונים לא זמינים כרגע.</span>`}
    ${!open && k && html`
      <${Record} daily=${s.daily} />
      <div class="card admin-summary"><span class="admin-spark" aria-hidden="true"><${Icon} name="spark" size=${16} /></span><span>${k.summary}</span></div>
      <div class="admin-kpis">
        ${k.tiles.map((t) => html`<div class="card admin-kpi" key=${t.label}><span class="muted">${t.label}</span><${CountUp} value=${t.value} />${t.note && html`<span class=${'admin-chg ' + (t.tone || '')}>${t.note}</span>`}<${Spark} values=${t.series} /></div>`)}
      </div>`}
    ${!open && wide && s && html`<div class="admin-row"><${AskCard} s=${s} /><${FeedCard} items=${s.feed} limit=${6} /></div>`}
    ${!open && !wide && s && html`<${FeedCard} items=${s.feed} limit=${4} />`}
    ${!open && html`<nav class=${wide ? 'admin-tools' : 'admin-hub'} aria-label="חלקי לוח הבעלים">
      ${hub.map((x) => html`<button type="button" class=${'card ' + (wide ? 'admin-tool' : 'admin-hub-btn')} key=${x.key} onClick=${() => openPart(x.key)}>
        <span class="admin-hub-ic"><${Icon} name=${x.icon} size=${18} /></span><span class="admin-hub-t"><b>${x.title}</b><small>${x.sub}</small></span><span aria-hidden="true">‹</span></button>`)}
    </nav>`}
    ${open && html`<section class=${'admin-sec admin-sec-' + open.key} aria-labelledby="adm-open"><h3 class="admin-sec-title" id="adm-open">${open.title}</h3><div class="stack">${open.body()}</div></section>`}
  </div>`;
}
