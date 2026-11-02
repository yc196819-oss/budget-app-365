// Operations: failures the app reports, usage events, and the numbers the
// owner looks at (who uses it, who comes back, what breaks). Pure.

// The only events kept: what someone did, never what they wrote or how much.
const EVENTS = ['app_open', 'tx_add', 'import_done', 'advisor_ask', 'advisor_talk', 'decision_open', 'decision_message', 'trip_plan', 'news_open', 'lesson_done', 'shortcut', 'export', 'restore', 'import_fail', 'guide_step', 'guide_skip', 'learn_auto', 'learn_undo', 'onboard_0', 'onboard_1', 'onboard_2', 'onboard_3', 'onboard_4', 'onboard_5', 'onboard_done'];
const text = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// A failure report from the app -> a row, or null. Never more than 20 at once.
function cleanErrors(list, { userId = null, agent = '' } = {}) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((e) => (e && typeof e === 'object' ? {
    user_id: userId, source: 'client',
    message: text(e.message, 500), detail: String(e.stack || e.detail || '').slice(0, 4000) || null,
    path: text(e.path, 300) || null, agent: text(agent, 300) || null
  } : null)).filter((r) => r && r.message);
}

// Usage events -> rows of known names only, at most 50 at once.
function cleanEvents(list, { userId, householdId = null }) {
  if (!userId) return [];
  return (Array.isArray(list) ? list : []).slice(0, 50).map((n) => String(n)).filter((n) => EVENTS.includes(n))
    .map((name) => ({ user_id: userId, household_id: householdId, name }));
}

const DAY = 86400000;
// The owner's dashboard: active people (1/7/30 days), how many came back a
// week after they started, what people use, and the failures of the week.
function stats({ events, errors, now = new Date() }) {
  const t = now.getTime();
  const within = (days) => new Set(events.filter((e) => t - new Date(e.at).getTime() < days * DAY).map((e) => e.user_id)).size;
  const first = new Map(), seen = new Map();
  for (const e of events) {
    const at = new Date(e.at).getTime();
    if (!first.has(e.user_id) || at < first.get(e.user_id)) first.set(e.user_id, at);
    if (!seen.has(e.user_id)) seen.set(e.user_id, []);
    seen.get(e.user_id).push(at);
  }
  // Of the people who started 8 to 60 days ago: who was back 7+ days later.
  const cohort = [...first.entries()].filter(([, f]) => t - f >= 8 * DAY && t - f <= 60 * DAY);
  const back = cohort.filter(([u, f]) => seen.get(u).some((at) => at - f >= 7 * DAY)).length;
  const use = {};
  for (const e of events) if (t - new Date(e.at).getTime() < 30 * DAY) use[e.name] = (use[e.name] || 0) + 1;
  const week = errors.filter((e) => t - new Date(e.at).getTime() < 7 * DAY);
  const byMsg = new Map();
  for (const e of week) { const k = e.message; const x = byMsg.get(k) || { message: k, count: 0, last: e.at, path: e.path }; x.count++; if (e.at > x.last) x.last = e.at; byMsg.set(k, x); }
  return {
    active: { day: within(1), week: within(7), month: within(30) },
    retention: { started: cohort.length, cameBack: back, pct: cohort.length ? Math.round((back / cohort.length) * 100) : null },
    use: Object.entries(use).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    errors: { week: week.length, top: [...byMsg.values()].sort((a, b) => b.count - a.count).slice(0, 10) }
  };
}

// A short-lived memory of verified sessions, so each request does not ask the
// auth server again (it is far away). Bounded, and a session is trusted for
// at most `ttl` ms and never past its own expiry.
function sessionCache({ ttl = 5 * 60 * 1000, max = 2000 } = {}) {
  const map = new Map();
  return {
    get(token, now = Date.now()) {
      const hit = map.get(token);
      if (!hit) return null;
      if (hit.until <= now) { map.delete(token); return null; }
      return hit.userId;
    },
    set(token, userId, expSeconds, now = Date.now()) {
      if (map.size >= max) map.delete(map.keys().next().value);
      const until = Math.min(now + ttl, expSeconds ? expSeconds * 1000 : now + ttl);
      if (until > now) map.set(token, { userId, until });
    },
    get size() { return map.size; }
  };
}

// The "exp" of a JWT, without verifying it (verification is the auth server's).
function tokenExp(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).exp || null; } catch (_e) { return null; }
}

// ── AI use per person: what each call cost, never what was said ──

// $ per million tokens (input, output). Unknown models count at the
// Sonnet price, so a cost is never under-reported.
const PRICES = {
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  gemini: [0.30, 2.50],
  grok: [0.20, 0.50]
};
function costOf(c) {
  const p = PRICES[c.model] || PRICES[c.provider] || PRICES['claude-sonnet-5'];
  return ((Number(c.input_tokens) || 0) * p[0] + (Number(c.output_tokens) || 0) * p[1]) / 1e6;
}

const int = (v) => Math.max(0, Math.round(Number(v) || 0));
function aiCallRow({ userId = null, route = 'system', provider, model = null, inputTokens, outputTokens }) {
  return { user_id: userId || null, route: text(route, 80), provider: text(provider, 20), model: text(model, 60) || null, input_tokens: int(inputTokens), output_tokens: int(outputTokens) };
}

// A stable label for a person that is not their email or id: the owner sees
// how each one uses the app, not who they are or what they wrote.
function alias(userId, salt = '') {
  return '#' + require('crypto').createHash('sha256').update(salt + ':' + userId).digest('hex').slice(0, 6);
}

// One row per person, last 30 days: when they joined and were last seen,
// how often they open the app, add, import, ask the advisor; AI calls,
// tokens and estimated cost. Busiest first.
// owners: ids of the owner's own accounts, marked so they are not taken for users.
function perUser({ users = [], events = [], calls = [], now = new Date(), salt = '', owners = [] }) {
  const since = now.getTime() - 30 * DAY;
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { id, joined: null, lastSeen: null, opens: 0, added: 0, imports: 0, importFails: 0, asked: 0, aiCalls: 0, tokens: 0, cost: 0 });
    return rows.get(id);
  };
  for (const u of users) row(u.id).joined = u.created_at ? String(u.created_at).slice(0, 10) : null;
  for (const e of events) {
    if (!e.user_id || new Date(e.at).getTime() < since) continue;
    const r = row(e.user_id);
    if (!r.lastSeen || e.at > r.lastSeen) r.lastSeen = e.at;
    if (e.name === 'app_open') r.opens++;
    else if (e.name === 'tx_add') r.added++;
    else if (e.name === 'import_done') r.imports++;
    else if (e.name === 'import_fail') r.importFails++;
    else if (e.name === 'advisor_ask' || e.name === 'advisor_talk') r.asked++;
  }
  let systemCost = 0;
  for (const c of calls) {
    if (new Date(c.at).getTime() < since) continue;
    if (!c.user_id) { systemCost += costOf(c); continue; }
    const r = row(c.user_id);
    r.aiCalls++;
    r.tokens += int(c.input_tokens) + int(c.output_tokens);
    r.cost += costOf(c);
  }
  const list = [...rows.values()]
    .map((r) => ({ ...r, id: undefined, who: alias(r.id, salt), owner: owners.includes(r.id), lastSeen: r.lastSeen ? String(r.lastSeen).slice(0, 10) : null, cost: Math.round(r.cost * 1000) / 1000 }))
    .sort((a, b) => b.aiCalls - a.aiCalls || b.opens - a.opens);
  const total = list.reduce((s, r) => s + r.cost, 0) + systemCost;
  return { users: list, aiCost30d: Math.round(total * 100) / 100, systemCost30d: Math.round(systemCost * 100) / 100 };
}

// ── who is here right now ──
// Each open app says "still here" every minute; seen in the last 2 minutes
// counts as online. Kept in memory only: the screen and the kind of device,
// never what is on it.
const SCREENS = ['home', 'money', 'together', 'plans', 'assets', 'login', 'onboarding', 'other'];
function presenceStore({ window = 2 * 60 * 1000, max = 20000 } = {}) {
  const seen = new Map();
  return {
    beat({ key, userId = null, screen = 'other', device = 'mobile', installed = false }, now = Date.now()) {
      if (!key) return;
      if (seen.size >= max && !seen.has(key)) seen.delete(seen.keys().next().value);
      seen.set(key, { at: now, userId, screen: SCREENS.includes(screen) ? screen : 'other', device: device === 'desktop' ? 'desktop' : 'mobile', installed: !!installed });
    },
    snapshot(now = Date.now()) {
      const out = { users: 0, visitors: 0, screens: {}, devices: { mobile: 0, desktop: 0 }, installed: 0 };
      const people = new Set();
      for (const [k, v] of seen) {
        if (now - v.at > window) { seen.delete(k); continue; }
        if (v.userId) { if (people.has(v.userId)) continue; people.add(v.userId); out.users++; } else out.visitors++;
        out.screens[v.screen] = (out.screens[v.screen] || 0) + 1;
        out.devices[v.device]++;
        if (v.installed) out.installed++;
      }
      return out;
    }
  };
}

// The last `days` days, oldest first: active people and AI cost each day
// (Israel time).
function daily({ events = [], calls = [], days = 14, now = new Date() }) {
  const dayOf = (iso) => new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const keys = Array.from({ length: days }, (_, i) => dayOf(new Date(now.getTime() - (days - 1 - i) * DAY).toISOString()));
  const act = new Map(keys.map((k) => [k, new Set()]));
  const cost = new Map(keys.map((k) => [k, 0]));
  for (const e of events) { const k = dayOf(e.at); if (act.has(k) && e.user_id) act.get(k).add(e.user_id); }
  for (const c of calls) { const k = dayOf(c.at); if (cost.has(k)) cost.set(k, cost.get(k) + costOf(c)); }
  return keys.map((k) => ({ day: k, active: act.get(k).size, cost: Math.round(cost.get(k) * 100) / 100 }));
}

// ── requests from users ──
const FEEDBACK_KINDS = ['bug', 'idea', 'other'];
const FEEDBACK_STATUS = ['new', 'working', 'done', 'wontfix'];
function cleanFeedback(body, userId) {
  const b = body || {};
  const t = String(b.text ?? '').replace(/\r/g, '').trim().slice(0, 2000);
  if (!userId || t.replace(/\s/g, '').length < 3) return null;
  return { user_id: userId, kind: FEEDBACK_KINDS.includes(b.kind) ? b.kind : 'other', text: t, screen: text(b.screen, 40) || null, device: text(b.device, 40) || null };
}
function feedbackPatch(body) {
  const b = body || {};
  const out = {};
  if (FEEDBACK_STATUS.includes(b.status)) out.status = b.status;
  if (typeof b.owner_note === 'string') out.owner_note = b.owner_note.trim().slice(0, 1000) || null;
  if (!Object.keys(out).length) return null;
  out.updated_at = new Date().toISOString();
  return out;
}

// ── one invitation back, to whoever signed up and stopped before the end ──
// Signed up 2+ days ago, confirmed, no household, never invited, not the owner.
// One-time emails the owner sends from the dashboard, each to the people at
// one step of getting started. A person gets each one once, ever.
//   start: signed up, never opened a household
//   first: opened a household, never uploaded a statement
//   more:  uploaded, but less than 6 months of statements
const CAMPAIGNS = ['start', 'first', 'more'];
function campaignList(campaign, { users = [], members = [], spans = [], sent = [], owners = [], now = new Date() }) {
  const householdOf = new Map(members.map((m) => [m.user_id, m.household_id]));
  const span = new Map(spans.map((x) => [x.household_id, { n: Number(x.n) || 0, months: Number(x.months) || 0 }]));
  const done = new Set(sent.filter((r) => (r.campaign || 'start') === campaign).map((r) => r.user_id));
  return users.filter((u) => {
    if (!u.email || !u.email_confirmed_at || done.has(u.id) || owners.includes(String(u.email).toLowerCase())) return false;
    if (now.getTime() - new Date(u.created_at).getTime() < 2 * DAY) return false;
    const inHousehold = householdOf.has(u.id);
    const s = (inHousehold && span.get(householdOf.get(u.id))) || { n: 0, months: 0 };
    if (campaign === 'start') return !inHousehold;
    if (campaign === 'first') return inHousehold && s.n === 0;
    if (campaign === 'more') return inHousehold && s.n > 0 && s.months < 6;
    return false;
  });
}
// Kept for the first campaign's callers and tests.
function reengageList(args) { return campaignList('start', args); }

// Lines starting with "• " are a list.
const WHY = 'ככל שיש יותר חודשים, המערכת והיועץ מבינים טוב יותר את ההרגלים שלך ויכולים לעזור באמת.';
const TIP_MONTHS = '• להעלות פירוט של 3 עד 6 החודשים האחרונים: המערכת תזהה לבד הוראות קבע ומנויים, התחזית לחודשים הבאים תהיה מדויקת יותר, והיועץ יוכל להשוות בין חודשים ולהראות מה השתנה.';
const TIP_CARDS = '• להעלות מכל כרטיסי האשראי: אם יש יותר מכרטיס אחד, כדאי להעלות את הפירוט של כולם, אחרת התמונה חלקית.';
const TIP_CASH = '• משלמים גם במזומן? אפשר להוסיף ידנית את ההוצאות העיקריות של כל חודש, לפי הערכה שלך (למשל שוק, דלק, דמי כיס).';
const WHERE = 'ברוב חברות האשראי מורידים את הפירוט (PDF או אקסל) מהאתר או מהאפליקציה שלהן, ומעלים אותו ב"ייבוא". אפשר להעלות כמה קבצים, אחד אחרי השני.';
const MAILS = {
  start: {
    title: 'נרשמו ולא פתחו משק בית',
    subject: 'בוא נראה יחד לאן הכסף שלך הולך',
    body: ['שמחתי לראות שנרשמת ל"התקציב שלנו".', 'האפליקציה מראה בכל רגע כמה נשאר להוציא החודש, לאן הכסף הולך ומה צפוי בחודשים הקרובים, ויש בה יועץ חכם שעונה על שאלות על הכסף שלך.', 'כדי להתחיל: פותחים משק בית ומעלים פירוט אשראי של החודשים האחרונים. ' + WHY, WHERE],
    button: 'לפתוח את התקציב שלי'
  },
  first: {
    title: 'פתחו משק בית ולא העלו פירוט',
    subject: 'הצעד שיפתח לך את התמונה המלאה',
    body: ['ראיתי שפתחת משק בית ב"התקציב שלנו". כל הכבוד!', 'הצעד הבא הוא זה שמפעיל את הכל: להעלות פירוט אשראי. המערכת קוראת וממיינת לבד, ותוך דקה רואים לאן הלך הכסף. כמה טיפים:', TIP_MONTHS, TIP_CARDS, TIP_CASH, WHERE],
    button: 'להעלות פירוט'
  },
  more: {
    title: 'העלו פירוט, פחות מ-6 חודשים',
    subject: '3 טיפים שיעשו את התקציב שלך מדויק באמת',
    body: ['ראיתי שכבר העלית פירוט ל"התקציב שלנו". מעולה!', 'כדי שהמערכת והיועץ יוכלו לעזור לך באמת, הם צריכים לראות את התמונה המלאה. שלושה טיפים:', TIP_MONTHS.replace('להעלות פירוט של 3 עד 6 החודשים האחרונים', 'להוסיף עוד חודשים אחורה, כך שיהיו בסך הכל 3 עד 6 חודשים'), TIP_CARDS, TIP_CASH, WHERE],
    button: 'להוסיף עוד פירוט'
  }
};
function campaignMail(campaign, link) {
  const m = MAILS[campaign];
  if (!m) return null;
  const sign = 'אם משהו לא עבד או לא היה ברור, פשוט תענה למייל הזה. אני קורא כל תשובה.';
  const text = 'היי,\n' + m.body.join('\n') + '\n\n' + m.button + ': ' + link + '\n\n' + sign + '\nקובי\n\nלא רוצה לקבל עוד מיילים? תענה "הסר".';
  let body = '';
  let list = [];
  const P = 'margin:0 0 14px;font-size:16px;line-height:1.65;color:#2B2118';
  const flush = () => {
    if (!list.length) return;
    body += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#FBF4EA;border-radius:12px">'
      + list.map((l) => '<tr><td width="28" valign="top" style="padding:12px 14px 0 0;font-size:16px;color:#92490A">✓</td><td style="padding:12px 0 0 14px;font-size:15px;line-height:1.6;color:#2B2118">' + l + '</td></tr>').join('')
      + '<tr><td colspan="2" style="height:12px"></td></tr></table>';
    list = [];
  };
  for (const line of m.body) {
    if (line.startsWith('• ')) list.push(line.slice(2));
    else { flush(); body += '<p style="' + P + '">' + line + '</p>'; }
  }
  flush();
  const origin = String(link).replace(/\/app\/?$/, '');
  const html = '<!doctype html><html lang="he" dir="rtl"><body style="margin:0;padding:0;background:#F3EDE6">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EDE6"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;text-align:right">'
    + '<tr><td style="padding:0 4px 14px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
    + '<td><img src="' + origin + '/wallet-192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px"></td>'
    + '<td style="padding-right:10px;font-size:19px;font-weight:bold;color:#2B2118">התקציב שלנו</td></tr></table></td></tr>'
    + '<tr><td style="background:#FFFFFF;border-radius:18px;padding:28px 26px;box-shadow:0 1px 3px rgba(0,0,0,.06)">'
    + '<p style="margin:0 0 14px;font-size:20px;font-weight:bold;color:#2B2118">היי,</p>' + body
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="background:#92490A;border-radius:12px">'
    + '<a href="' + link + '" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none">' + m.button + '</a></td></tr></table>'
    + '<p style="margin:0;font-size:15px;line-height:1.6;color:#5B4B3D">' + sign + '</p>'
    + '<p style="margin:10px 0 0;font-size:15px;font-weight:bold;color:#2B2118">קובי</p></td></tr>'
    + '<tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.6;color:#8A7B6E;text-align:center">קיבלת את המייל כי נרשמת ל"התקציב שלנו". לא רוצה לקבל עוד מיילים? תענה "הסר".</td></tr>'
    + '</table></td></tr></table></body></html>';
  return { subject: m.subject, text, html };
}
function reengageMail(link) { return campaignMail('start', link); }
const campaignTitle = (c) => (MAILS[c] ? MAILS[c].title : '');

// Can the server email people? Resend's shared test address only delivers to
// the Resend account's own email, so it does not count.
function mailReady({ resendKey = '', resendFrom = '', smtp = false } = {}) {
  const resend = !!resendKey && !/@resend\.dev>?\s*$/i.test(String(resendFrom));
  return { ready: smtp || resend, smtp: !!smtp, resend, resendTestOnly: !!resendKey && !resend };
}

module.exports = { reengageList, reengageMail, campaignList, campaignMail, campaignTitle, mailReady, CAMPAIGNS, cleanFeedback, feedbackPatch, EVENTS, cleanErrors, cleanEvents, stats, sessionCache, tokenExp, aiCallRow, costOf, alias, perUser, presenceStore, daily };
