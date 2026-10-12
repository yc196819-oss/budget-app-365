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

module.exports = { cleanRequest, estimatePrompt, pickEstimate };
