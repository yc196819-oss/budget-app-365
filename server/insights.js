// The owner dashboard's extras: what is happening right now (a short feed),
// and a question about the numbers answered by the AI from totals only.
// Pure: no database, no network.

// The things worth seeing in the feed, in plain words. Everything else
// (opening a screen, small taps) is left out so the feed stays readable.
const FEED = {
  signup: 'נרשם/ה',
  import_done: 'העלה/תה פירוט',
  first_value: 'ראה/תה חודש מהנתונים שלו/ה לראשונה',
  advisor_ask: 'שאל/ה את היועץ',
  advisor_talk: 'דיבר/ה עם היועץ',
  tx_add: 'הוסיף/ה תנועה',
  shop_add: 'הוסיף/ה לרשימת הקניות',
  shop_done: 'סיים/ה קנייה',
  decision_open: 'פתח/ה החלטה משותפת',
  trip_plan: 'תכנן/ה טיול',
  lesson_done: 'סיים/ה שיעור',
  onboard_done: 'סיים/ה את ההרשמה',
  import_fail: 'נכשל/ה בהעלאה'
};
const FEED_KIND = { signup: 'join', onboard_done: 'join', import_done: 'data', first_value: 'data', import_fail: 'fail', advisor_ask: 'ai', advisor_talk: 'ai' };

// The newest moments, newest first; repeated taps of the same person on the
// same thing within 10 minutes count once ("added 4 items" is one line).
function feed({ events = [], users = [], nameOf = () => '', now = new Date(), limit = 14 } = {}) {
  const since = now.getTime() - 48 * 3600 * 1000;
  const rows = [];
  for (const u of users) {
    const t = Date.parse(u.created_at);
    if (t >= since) rows.push({ id: u.id, name: 'signup', t });
  }
  for (const e of events) {
    const name = String(e.name || '').startsWith('import_fail') ? 'import_fail' : e.name;
    const t = Date.parse(e.at);
    if (!FEED[name] || !(t >= since) || !e.user_id) continue;
    rows.push({ id: e.user_id, name, t });
  }
  rows.sort((a, b) => b.t - a.t);
  const out = [];
  for (const r of rows) {
    const same = out.find((o) => o.id === r.id && o.name === r.name && o.t - r.t < 10 * 60 * 1000);
    if (same) { same.n++; continue; }
    out.push({ ...r, n: 1 });
    if (out.length >= limit) break;
  }
  return out.map((r) => ({
    at: new Date(r.t).toISOString(),
    who: nameOf(r.id) || 'משתמש/ת',
    what: FEED[r.name] + (r.n > 1 ? ' (' + r.n + ' פעמים)' : ''),
    kind: FEED_KIND[r.name] || 'use'
  }));
}

// A question about the numbers: only totals go to the AI (counts per day,
// per step, per week), never names, emails, ids or what anyone wrote.
function askFacts(s) {
  const x = s || {};
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    active: x.active || null,
    signedUp: x.signedUp ?? null,
    households: x.members ?? null,
    retention: x.retention ? pick(x.retention, ['pct', 'cameBack', 'started']) : null,
    funnel30d: x.funnel ? pick(x.funnel, ['signups', 'household', 'tx', 'import', 'cameBack']) : null,
    daily: (x.daily || []).map((d) => ({ day: d.day, active: d.active, aiCostUsd: d.cost })),
    weeks: (x.cohorts || []).map((c) => pick(c, ['week', 'signups', 'household', 'withData', 'imported', 'oldEnough', 'cameBack'])),
    upload30d: x.upload ? pick(x.upload, ['opened', 'picked', 'saved', 'failedPeople', 'files', 'reasons', 'leftAt']) : null,
    use30d: (x.use || []).slice(0, 25),
    aiCost30dUsd: x.aiCost30d ?? null,
    errorsThisWeek: x.errors ? x.errors.week : null
  };
}

function askPrompt(question, facts) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (q.length < 3) return null;
  return `אתה אנליסט של אפליקציית תקציב משפחתי קטנה. בעל האפליקציה שואל שאלה על המספרים.
ענה בעברית פשוטה, קצר (עד 5 משפטים), עם המספרים המדויקים מהנתונים. אם אי אפשר לענות מהנתונים, אמור זאת ואמור מה היה צריך למדוד.
אל תמציא מספרים. תאריכים לפי שעון ישראל. "use30d" הוא כמה פעמים נעשתה כל פעולה ב-30 יום.

הנתונים (סיכומים בלבד):
${JSON.stringify(facts)}

השאלה: ${q}`;
}

module.exports = { feed, askFacts, askPrompt, FEED };
