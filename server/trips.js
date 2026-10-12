// The trip advisor's estimate for a destination: flights, lodging and the
// cost of living there next to the family's last trip. The prompt and the
// cleaning of the answer are pure, so they are tested without the network.

const CATS = ['food', 'transport', 'attractions', 'shopping', 'other'];
const clampNum = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null; };
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function cleanRequest(body) {
  const b = body || {};
  const destination = text(b.destination, 60);
  if (!destination) return null;
  const month = MONTH.test(String(b.month || '')) ? String(b.month) : null;
  const past = b.past && typeof b.past === 'object' ? b.past : null;
  return {
    destination,
    month,
    days: clampNum(b.days, 1, 60) || 6,
    travelers: clampNum(b.travelers, 1, 20) || 2,
    past: past ? {
      country: text(past.country, 40),
      days: clampNum(past.days, 1, 120),
      travelers: clampNum(past.travelers, 1, 20),
      flight_per_person: clampNum(past.flight_per_person, 0, 100000),
      lodging_per_night: clampNum(past.lodging_per_night, 0, 100000),
      per_person_per_day: Object.fromEntries(CATS.map((k) => [k, clampNum(past.per_person_per_day && past.per_person_per_day[k], 0, 100000) || 0]))
    } : null
  };
}

function estimatePrompt(req, today) {
  const past = req.past
    ? `הטיול הקודם של המשפחה: ${req.past.country || 'חו״ל'}, ${req.past.days} ימים, ${req.past.travelers} נוסעים. טיסה לאדם ₪${req.past.flight_per_person}, לינה ללילה ₪${req.past.lodging_per_night}. לאדם ליום (₪): ${CATS.map((k) => k + ' ' + req.past.per_person_per_day[k]).join(', ')}.`
    : 'אין טיול קודם להשוואה; השווה ליוקר המחיה בישראל (100%).';
  return `אתה יועץ טיולים למשפחה ישראלית שטסה מנתב"ג. היום ${today}.
יעד: ${req.destination}. ${req.month ? 'חודש הנסיעה: ' + req.month + '.' : 'עוד לא נבחר חודש.'} ${req.days} ימים, ${req.travelers} נוסעים.
${past}
תן הערכה מבוססת ידע (אין לך מחירים חיים; היה מציאותי ושמרני, לא אופטימי):
- טיסה הלוך-חזור מת"א לאדם בשקלים בחודש הזה, טווח ומחיר טיפוסי (חברות רגילות ולואו-קוסט).
- לינה סבירה ללילה לחדר זוגי בשקלים (מלון 3 כוכבים או דירה טובה), טווח וטיפוסי.
- יוקר המחיה ביעד באחוזים לעומת הטיול הקודם, לכל קטגוריה: food, transport, attractions, shopping, other (למשל 40 = יקר ב-40%, ‎-20 = זול ב-20%).
- המטבע המקומי (קוד ISO), והוצאה טיפוסית ליום לאדם במטבע המקומי בלי לינה.
- עונה בחודש הזה (high/shoulder/low), ועד 3 חודשים בשנה הקרובה שבהם הנסיעה זולה יותר, ולמה במשפט.
- עד 3 טיפים קצרים לחיסכון ביעד הזה.
החזר JSON בלבד:
{"destination":"שם היעד בעברית","country":"מדינה בעברית","currency":"EUR","flight_per_person":{"low":0,"typical":0,"high":0},"lodging_per_night":{"low":0,"typical":0,"high":0},"percent_vs_past":{"food":0,"transport":0,"attractions":0,"shopping":0,"other":0},"daily_per_person_local":0,"season":"high","cheaper_months":["YYYY-MM"],"cheaper_note":"...","tips":["..."],"confidence":"low|medium|high"}`;
}

function range(v, max) {
  const o = v && typeof v === 'object' ? v : {};
  const low = clampNum(o.low, 0, max), high = clampNum(o.high, 0, max);
  let typical = clampNum(o.typical, 0, max);
  if (typical == null && low != null && high != null) typical = Math.round((low + high) / 2);
  if (!(typical > 0)) return null;
  return { low: low ?? typical, typical, high: high ?? typical };
}

// The model's JSON -> a safe, bounded estimate, or null.
function pickEstimate(raw, today) {
  if (!raw || typeof raw !== 'object') return null;
  const flight = range(raw.flight_per_person, 60000);
  const lodging = range(raw.lodging_per_night, 30000);
  if (!flight || !lodging) return null;
  const pct = {};
  for (const k of CATS) { const p = clampNum(raw.percent_vs_past && raw.percent_vs_past[k], -80, 300); if (p != null) pct[k] = p; }
  const currency = /^[A-Z]{3}$/.test(String(raw.currency || '')) ? raw.currency : null;
  const thisMonth = String(today).slice(0, 7);
  return {
    destination: text(raw.destination, 60),
    country: text(raw.country, 40),
    currency,
    flight_per_person: flight,
    lodging_per_night: lodging,
    percent_vs_past: pct,
    daily_per_person_local: clampNum(raw.daily_per_person_local, 0, 10000000),
    season: ['high', 'shoulder', 'low'].includes(raw.season) ? raw.season : null,
    cheaper_months: (Array.isArray(raw.cheaper_months) ? raw.cheaper_months : []).map(String).filter((m) => MONTH.test(m) && m > thisMonth).slice(0, 3),
    cheaper_note: text(raw.cheaper_note, 200),
    tips: (Array.isArray(raw.tips) ? raw.tips : []).map((t) => text(t, 160)).filter(Boolean).slice(0, 3),
    confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium'
  };
}

// ── the trip chat: the family says what is different for them, the chat
// answers and changes the plan. The model returns words and a list of
// changes; only known keys, categories and bounded numbers get through.

const PLAN_CATS = ['flights', 'lodging', 'food', 'transport', 'attractions', 'shopping', 'other'];
const LABELS = { flights: 'טיסות', lodging: 'לינה', food: 'אוכל', transport: 'תחבורה ורכב', attractions: 'אטרקציות', shopping: 'קניות', other: 'ביטוח ושונות' };
const catsOf = (v) => (Array.isArray(v) ? v : []).map(String).filter((k) => PLAN_CATS.includes(k)).filter((k, i, a) => a.indexOf(k) === i);
const amounts = (o, max, { all = false, lo = 0 } = {}) => {
  const out = {};
  for (const k of PLAN_CATS) {
    const v = o && typeof o === 'object' ? o[k] : undefined;
    if (v === undefined || v === null) continue;
    if (all && v === 'all') { out[k] = 'all'; continue; }
    const n = clampNum(v, lo, max);
    if (n != null) out[k] = n;
  }
  return out;
};

function cleanChat(body) {
  const b = body || {};
  const message = text(b.message, 600);
  if (!message) return null;
  const c = b.context && typeof b.context === 'object' ? b.context : {};
  const prefs = c.prefs && typeof c.prefs === 'object' ? c.prefs : {};
  return {
    message,
    history: (Array.isArray(b.history) ? b.history : []).slice(-10)
      .map((m) => ({ role: m && m.role === 'ai' ? 'ai' : 'me', text: text(m && m.text, 600) })).filter((m) => m.text),
    context: {
      destination: text(c.destination, 60),
      month: MONTH.test(String(c.month || '')) ? String(c.month) : null,
      days: clampNum(c.days, 1, 60) || 6,
      travelers: clampNum(c.travelers, 1, 20) || 2,
      past: text(c.past, 60),
      lines: amounts(c.lines, 1000000),
      prefs: {
        skip: catsOf(prefs.skip),
        covered: amounts(prefs.covered, 1000000, { all: true }),
        fixed: amounts(prefs.fixed, 1000000),
        pct: amounts(prefs.pct, 300, { lo: -100 }),
        funding: clampNum(prefs.funding, 0, 1000000) || 0,
        notes: (Array.isArray(prefs.notes) ? prefs.notes : []).map((n) => text(n, 80)).filter(Boolean).slice(0, 8)
      },
      estimate: c.estimate && typeof c.estimate === 'object' ? {
        flight: clampNum(c.estimate.flight, 0, 100000), lodging: clampNum(c.estimate.lodging, 0, 100000),
        currency: /^[A-Z]{3}$/.test(String(c.estimate.currency || '')) ? c.estimate.currency : null,
        daily_local: clampNum(c.estimate.daily_local, 0, 10000000)
      } : null
    }
  };
}

function chatPrompt(req, today) {
  const c = req.context;
  const lines = PLAN_CATS.map((k) => `${k} (${LABELS[k]}): ₪${c.lines[k] || 0}`).join(', ');
  const p = c.prefs;
  const prefs = [
    p.skip.length ? 'לא צריך: ' + p.skip.join(', ') : '',
    Object.keys(p.covered).length ? 'ממומן ע"י אחרים: ' + Object.entries(p.covered).map(([k, v]) => k + ' ' + (v === 'all' ? 'הכל' : '₪' + v)).join(', ') : '',
    Object.keys(p.fixed).length ? 'מחיר ידוע: ' + Object.entries(p.fixed).map(([k, v]) => k + ' ₪' + v).join(', ') : '',
    Object.keys(p.pct).length ? 'שינוי באחוזים: ' + Object.entries(p.pct).map(([k, v]) => k + ' ' + v + '%').join(', ') : '',
    p.funding ? 'כסף שכבר יש לטיול: ₪' + p.funding : '',
    p.notes.length ? 'עובדות: ' + p.notes.join('; ') : ''
  ].filter(Boolean).join('\n') || 'אין עדיין התאמות.';
  const est = c.estimate ? `הערכת היועץ: טיסה לאדם ₪${c.estimate.flight || '?'}, לינה ללילה ₪${c.estimate.lodging || '?'}${c.estimate.currency ? ', מטבע ' + c.estimate.currency + (c.estimate.daily_local ? ', ליום לאדם ' + c.estimate.daily_local + ' ' + c.estimate.currency : '') : ''}.` : '';
  const convo = req.history.map((m) => (m.role === 'ai' ? 'יועץ: ' : 'משתמש: ') + m.text).join('\n');
  return `אתה יועץ הטיולים באפליקציית התקציב של משפחה ישראלית. היום ${today}.
אתה עוזר להתאים את תקציב הטיול לצרכים האישיים שלהם, ומשנה את התוכנית כשהם מספרים משהו.
הטיול: ${c.destination || 'יעד לא נבחר'}${c.month ? ', ' + c.month : ''}, ${c.days} ימים, ${c.travelers} נוסעים.${c.past ? ' התוכנית מבוססת על ' + c.past + '.' : ''}
התוכנית עכשיו (סה"כ לכל הטיול, בשקלים): ${lines}.
${est}
ההתאמות עד עכשיו:
${prefs}
${convo ? 'השיחה עד עכשיו:\n' + convo : ''}

כללים:
- "לא צריך לינה/אוכל" (ישנים אצל משפחה, אוכלים אצלם) → skip. "מישהו משלם/יש מימון ל..." → covered ("all" או סכום). "הטיסה כבר עולה X" → fixed (סה"כ לכל הנוסעים). "אוכל חצי מהזמן אצל משפחה" → pct שלילי (‎-50). "יש לי כבר X בצד/מתנה לטיול" → funding.
- ביטול התאמה: clear עם הקטגוריה. שינוי ימים/נוסעים/חודש/יעד: days, travelers, month (YYYY-MM), destination.
- הוסף ל-notes_add עובדה קצרה (עד 8 מילים) לכל דבר אישי שסיפרו, כדי לזכור אותו.
- אם שואלים שאלה (מה כדאי, כמה עולה, מתי זול) – ענה מהידע שלך, מציאותי ושמרני, בלי להמציא מחירים מדויקים, ושנה רק אם ביקשו.
- אם לא ברור – שאל שאלה אחת קצרה ואל תשנה.
- reply: עברית, קצר (עד 3 משפטים), תגיד מה שינית ואיך זה משפיע.
קטגוריות: ${PLAN_CATS.join(', ')}.

ההודעה החדשה: ${req.message}

החזר JSON בלבד:
{"reply":"...","changes":{"skip":[],"unskip":[],"covered":{},"fixed":{},"pct":{},"clear":[],"funding":null,"days":null,"travelers":null,"month":null,"destination":null,"notes_add":[],"notes_remove":[]}}`;
}

// The model's JSON -> { reply, changes } with only what the app knows.
function pickChat(raw, today) {
  if (!raw || typeof raw !== 'object') return null;
  const reply = text(raw.reply, 600);
  if (!reply) return null;
  const c = raw.changes && typeof raw.changes === 'object' ? raw.changes : {};
  const ch = {};
  const skip = catsOf(c.skip); if (skip.length) ch.skip = skip;
  const unskip = catsOf(c.unskip); if (unskip.length) ch.unskip = unskip;
  const clear = catsOf(c.clear); if (clear.length) ch.clear = clear;
  const covered = amounts(c.covered, 1000000, { all: true }); if (Object.keys(covered).length) ch.covered = covered;
  const fixed = amounts(c.fixed, 1000000); if (Object.keys(fixed).length) ch.fixed = fixed;
  const pct = amounts(c.pct, 300, { lo: -100 }); if (Object.keys(pct).length) ch.pct = pct;
  if (c.funding !== null && c.funding !== undefined) { const f = clampNum(c.funding, 0, 1000000); if (f != null) ch.funding = f; }
  const days = clampNum(c.days, 1, 60); if (days) ch.days = days;
  const travelers = clampNum(c.travelers, 1, 20); if (travelers) ch.travelers = travelers;
  if (MONTH.test(String(c.month || '')) && String(c.month) > String(today).slice(0, 7)) ch.month = String(c.month);
  const destination = text(c.destination, 60); if (destination) ch.destination = destination;
  const notes = (Array.isArray(c.notes_add) ? c.notes_add : []).map((n) => text(n, 80)).filter(Boolean).slice(0, 4); if (notes.length) ch.notes_add = notes;
  const gone = (Array.isArray(c.notes_remove) ? c.notes_remove : []).map((n) => text(n, 80)).filter(Boolean).slice(0, 8); if (gone.length) ch.notes_remove = gone;
  return { reply, changes: ch };
}

module.exports = { cleanRequest, estimatePrompt, pickEstimate, cleanChat, chatPrompt, pickChat };
