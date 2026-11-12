// Operations: failures the app reports, usage events, and the numbers the
// owner looks at (who uses it, who comes back, what breaks). Pure.

// The only events kept: what someone did, never what they wrote or how much.
const EVENTS = ['app_open', 'open_desktop', 'open_mobile', 'open_installed', 'tx_add', 'import_done', 'advisor_ask', 'advisor_talk', 'decision_open', 'decision_message', 'trip_plan', 'news_open', 'lesson_done', 'shortcut', 'export', 'restore', 'import_fail', 'guide_step', 'guide_skip', 'learn_auto', 'learn_undo', 'onboard_0', 'onboard_1', 'onboard_2', 'onboard_3', 'onboard_4', 'onboard_5', 'onboard_done', 'share', 'share_joined', 'howto', 'repair_shown', 'repair_fix', 'repair_skip',
  // Where an upload stops: opened, which kind of file, why it failed (a fixed word), left at which step.
  // A click on an email's button (which email it was).
  ...['start', 'first', 'more', 'picture', 'nudge', 'fixed', 'monthly'].map((c) => 'mail_click_' + c),
  'import_open', 'import_file_xlsx', 'import_file_xls', 'import_file_csv', 'import_file_pdf', 'import_file_image', 'import_file_other',
  ...['ai_off', 'excel', 'password', 'xls', 'type', 'empty', 'pdf_scan', 'image_big', 'no_rows', 'junk', 'other'].map((c) => 'import_fail_' + c),
  ...['pick', 'work', 'review', 'error'].map((s) => 'import_abandon_' + s),
  // The first month built from their own data; the shopping list in use.
  'first_value', 'shop_add', 'shop_done', 'shop_reuse', 'picture_open', 'picture_add', 'picture_check', 'guide_start', 'guide_upload', 'guide_skip_step', 'share_in', 'share_pick', 'picture_cards_only', 'picture_cards_only_undo', 'transfer_mark', 'transfer_undo', 'transfer_yes', 'transfer_no', 'transfer_days', 'move_bit_refund', 'move_bit_income', 'move_bit_own', 'move_invest_move', 'move_invest_income', 'fixed_open', 'fixed_ok', 'fixed_link', 'price_open', 'price_pick', 'price_notify'];
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

// Every row, page by page: the database hands back at most 1,000 rows (and
// the auth server 1,000 people) per request, so a longer list would be cut
// short without a word. fetchPage(from, to, page) returns one page. Stops at
// a short page; maxPages is a safety net, never reached in practice.
async function pageAll(fetchPage, size = 1000, maxPages = 500) {
  const out = [];
  for (let p = 0; p < maxPages; p++) {
    const rows = await fetchPage(p * size, p * size + size - 1, p + 1);
    out.push(...(rows || []));
    if (!rows || rows.length < size) break;
  }
  return out;
}

// A household's AI actions a month: its own limit when one was set, else a
// default far above what anyone uses today (the busiest home is near 450),
// so nobody real is stopped while a runaway loop or abuse is.
const AI_MONTHLY_DEFAULT = 600;
function aiMonthlyLimit(own, fallback) {
  if (own != null && Number.isFinite(Number(own))) return Number(own);
  const f = Number(fallback);
  return Number.isFinite(f) && f > 0 ? f : AI_MONTHLY_DEFAULT;
}

// The owner's weekly view: people grouped by the week they signed up
// (weeks start on Sunday), and how far each group got: a household, data of
// their own, an upload, back a week later. "Back" is counted only for whoever
// signed up more than 8 days ago. Ids in, numbers out. Pure.
function weekOf(iso) {
  const d = new Date(iso);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}
function cohorts({ users = [], info = new Map(), events = [], now = new Date(), weeks = 8 }) {
  const byUser = new Map();
  for (const e of events) { if (!byUser.has(e.user_id)) byUser.set(e.user_id, []); byUser.get(e.user_id).push(e); }
  const from = weekOf(new Date(now.getTime() - (weeks - 1) * 7 * DAY).toISOString());
  const rows = new Map();
  for (const u of users) {
    const week = weekOf(u.created_at);
    if (week < from) continue;
    const r = rows.get(week) || { week, signups: 0, household: 0, withData: 0, imported: 0, oldEnough: 0, cameBack: 0 };
    const x = info.get(u.id) || {};
    const ev = byUser.get(u.id) || [];
    const start = new Date(u.created_at).getTime();
    r.signups++;
    if (x.inHousehold) r.household++;
    if (x.txCount > 0) r.withData++;
    if (ev.some((e) => e.name === 'import_done')) r.imported++;
    if (now.getTime() - start > 8 * DAY) {
      r.oldEnough++;
      if (ev.some((e) => new Date(e.at).getTime() - start >= 7 * DAY)) r.cameBack++;
    }
    rows.set(week, r);
  }
  return [...rows.values()].sort((a, b) => b.week.localeCompare(a.week));
}
// Where uploads stop (30 days): how many people opened one, picked a file,
// saved; why it failed and at which step people left, most common first. Pure.
function uploadFunnel(events = [], now = new Date(), days = 30) {
  const recent = events.filter((e) => now.getTime() - new Date(e.at).getTime() < days * DAY);
  const people = (test) => new Set(recent.filter((e) => test(e.name)).map((e) => e.user_id)).size;
  const count = (prefix) => {
    const m = new Map();
    for (const e of recent) if (e.name.startsWith(prefix)) { const k = e.name.slice(prefix.length); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
  };
  return {
    opened: people((n) => n === 'import_open'),
    picked: people((n) => n.startsWith('import_file_')),
    saved: people((n) => n === 'import_done'),
    failedPeople: people((n) => n === 'import_fail'),
    files: count('import_file_'),
    reasons: count('import_fail_'),
    leftAt: count('import_abandon_')
  };
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

// The code in a person's "tell your friends" link: stable, short, and not
// the same as their label on the owner's dashboard.
function refCode(userId, salt = '') { return alias(userId, 'ref:' + salt).slice(1); }
// For the owner: how many times each person shared (events, 30 days) and
// how many joined with their link (all time); and the owner's own, apart.
function shareStats({ users = [], events = [], referrals = [], salt = '', owners = [] }) {
  const joinedBy = new Map();
  for (const r of referrals) joinedBy.set(r.ref_code, (joinedBy.get(r.ref_code) || 0) + 1);
  const shares = new Map();
  for (const e of events) if (e.name === 'share' && e.user_id) shares.set(e.user_id, (shares.get(e.user_id) || 0) + 1);
  const byUser = new Map();
  const mine = { shares: 0, friends: 0 };
  for (const u of users) {
    const x = { shares: shares.get(u.id) || 0, friends: joinedBy.get(refCode(u.id, salt)) || 0 };
    if (owners.includes(u.id)) { mine.shares += x.shares; mine.friends += x.friends; } else byUser.set(u.id, x);
  }
  const others = [...byUser.values()];
  return { byUser, totals: { shares: others.reduce((t, x) => t + x.shares, 0), friends: others.reduce((t, x) => t + x.friends, 0), sharers: others.filter((x) => x.shares > 0).length, mine } };
}

// One row per person, last 30 days: when they joined and were last seen,
// how often they open the app, add, import, ask the advisor; AI calls,
// tokens and estimated cost. Busiest first.
// owners: ids of the owner's own accounts. They are left out of the list (the
// owner wants to see the others); what their AI use cost is given apart.
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
  const all = [...rows.values()];
  const ownerCost = all.filter((r) => owners.includes(r.id)).reduce((s, r) => s + r.cost, 0);
  const list = all.filter((r) => !owners.includes(r.id))
    .map((r) => ({ ...r, id: undefined, who: alias(r.id, salt), lastSeen: r.lastSeen ? String(r.lastSeen).slice(0, 10) : null, cost: Math.round(r.cost * 1000) / 1000 }))
    .sort((a, b) => b.aiCalls - a.aiCalls || b.opens - a.opens);
  const total = all.reduce((s, r) => s + r.cost, 0) + systemCost;
  return { users: list, aiCost30d: Math.round(total * 100) / 100, systemCost30d: Math.round(systemCost * 100) / 100, ownerCost30d: Math.round(ownerCost * 100) / 100 };
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
    // exclude: ids not counted (the owner's own accounts).
    snapshot(now = Date.now(), exclude = []) {
      const out = { users: 0, visitors: 0, screens: {}, devices: { mobile: 0, desktop: 0 }, installed: 0 };
      const people = new Set();
      for (const [k, v] of seen) {
        if (now - v.at > window) { seen.delete(k); continue; }
        if (v.userId && exclude.includes(v.userId)) continue;
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
//   picture: has a household, less than 6 months: what is new (completing
//            the picture, step by step), even after an earlier email
//   nudge: came in and opened a household 3+ days ago, uploaded nothing:
//          a short, personal note with a picture of the upload, even after
//          an earlier email
//   fixed: their Excel statement was read as empty (a fault of ours, fixed
//          since) and they did not upload after it: "fixed, try again"
const CAMPAIGNS = ['start', 'first', 'more', 'picture', 'nudge', 'fixed'];
// The emails the owner can still send. "first" was replaced by "nudge" (the
// same people, a personal letter with a picture); what it already sent stays
// in the history and the numbers.
const RETIRED = ['first'];
const ON_BOARD = CAMPAIGNS.filter((c) => !RETIRED.includes(c));
// At most one email a week from us to a person, whatever its kind. Not
// counted: what the person asked for (the monthly summary they turned on,
// an answer to their request, sign-in codes, sign-up and password emails,
// which Supabase sends). A send that failed did not reach them. Pure.
const WEEK = 7 * DAY;
const askedFor = (campaign) => /^monthly-/.test(String(campaign || ''));
function mailedThisWeek(rows = [], now = new Date()) {
  return rows.some((r) => !askedFor(r.campaign) && r.ok !== false && r.sent_at && now.getTime() - new Date(r.sent_at).getTime() < WEEK);
}
function campaignList(campaign, { users = [], members = [], spans = [], sent = [], owners = [], stopped = [], failed = [], now = new Date() }) {
  const off = new Set(stopped);
  for (const u of new Set(sent.map((r) => r.user_id))) if (mailedThisWeek(sent.filter((r) => r.user_id === u), now)) off.add(u);
  const householdOf = new Map(members.map((m) => [m.user_id, m.household_id]));
  const span = new Map(spans.map((x) => [x.household_id, { n: Number(x.n) || 0, months: Number(x.months) || 0 }]));
  const done = new Set(sent.filter((r) => (r.campaign || 'start') === campaign).map((r) => r.user_id));
  return users.filter((u) => {
    if (!u.email || !u.email_confirmed_at || done.has(u.id) || off.has(u.id) || owners.includes(String(u.email).toLowerCase())) return false;
    if (now.getTime() - new Date(u.created_at).getTime() < 2 * DAY) return false;
    const inHousehold = householdOf.has(u.id);
    const s = (inHousehold && span.get(householdOf.get(u.id))) || { n: 0, months: 0 };
    if (campaign === 'start') return !inHousehold;
    if (campaign === 'first') return inHousehold && s.n === 0;
    if (campaign === 'more') return inHousehold && s.n > 0 && s.months < 6;
    if (campaign === 'picture') return inHousehold && s.months < 6;
    if (campaign === 'fixed') return failed.includes(u.id);
    if (campaign === 'nudge') return inHousehold && s.n === 0 && now.getTime() - new Date(u.created_at).getTime() >= 3 * DAY;
    return false;
  });
}
// For the dashboard: per email, how many it went to, how many failed, when
// last; and how many asked to stop. Pure.
function campaignStats(sent = [], stopped = []) {
  const out = {};
  for (const r of sent) {
    if (!CAMPAIGNS.includes(r.campaign)) continue;
    const c = out[r.campaign] || (out[r.campaign] = { sent: 0, failed: 0, last: null });
    if (r.ok === false) c.failed++; else c.sent++;
    if (r.sent_at && (!c.last || r.sent_at > c.last)) c.last = r.sent_at;
  }
  return { byCampaign: out, stopped: stopped.length };
}
// Kept for the first campaign's callers and tests.
function reengageList(args) { return campaignList('start', args); }

// Lines starting with "• " are a list.
const WHY = 'ככל שיש יותר חודשים, המערכת והיועץ מבינים טוב יותר את ההרגלים שלך ויכולים לעזור באמת.';
const TIP_MONTHS = '• להעלות פירוט של 3 עד 6 החודשים האחרונים: המערכת תזהה לבד הוראות קבע ומנויים, התחזית לחודשים הבאים תהיה מדויקת יותר, והיועץ יוכל להשוות בין חודשים ולהראות מה השתנה.';
const TIP_CARDS = '• להעלות מכל כרטיסי האשראי: אם יש יותר מכרטיס אחד, כדאי להעלות את הפירוט של כולם, אחרת התמונה חלקית.';
const TIP_CASH = '• משלמים גם במזומן? אפשר להוסיף ידנית את ההוצאות העיקריות של כל חודש, לפי הערכה שלך (למשל שוק, דלק, דמי כיס).';
const WHERE = 'ברוב חברות האשראי מורידים את הפירוט (PDF או אקסל) מהאתר או מהאפליקציה שלהן, ומעלים אותו ב"ייבוא". אפשר להעלות כמה קבצים, אחד אחרי השני.';
// What is new: completing the picture, made simple.
const EASY = 'חדש ופשוט: בעמוד הבית יש כרטיס "השלמת התמונה". בוחרים פעם אחת את הבנק ואת כרטיסי האשראי שלכם (לפי הלוגו), ורואים בדיוק איזה פירוט חסר ולאיזה חודש. ליד כל אחד יש הסבר קצר, צעד אחר צעד, איך מורידים אותו מהאתר של הבנק או של חברת האשראי.';
const NOSTATE = 'אין כוח לפירוטים עכשיו? אפשר להתחיל גם בלי: כותבים בערך כמה נכנס וכמה יוצא בחודש, ומוסיפים פירוטים אחר כך.';
const MAILS = {
  start: {
    title: 'נרשמו ולא פתחו משק בית',
    subject: 'בוא נראה יחד לאן הכסף שלך הולך',
    body: ['שמחנו לראות שנרשמת ל"התקציב שלנו".', 'האפליקציה מראה בכל רגע כמה נשאר להוציא החודש, לאן הכסף הולך ומה צפוי בחודשים הקרובים, ויש בה יועץ חכם שעונה על שאלות על הכסף שלך.', 'כדי להתחיל: נכנסים, עונים על שתי שאלות (לוקח 10 שניות), ומעלים פירוט אשראי של 6 החודשים האחרונים, מכל הכרטיסים. ' + WHY, 'ואין צורך לנחש איך: האפליקציה מראה לכל בנק ולכל חברת אשראי, צעד אחר צעד, איך מורידים את הפירוט.', NOSTATE],
    button: 'לפתוח את התקציב שלי'
  },
  first: {
    title: 'פתחו משק בית ולא העלו פירוט',
    subject: 'הצעד שיפתח לך את התמונה המלאה',
    body: ['ראינו שפתחת משק בית ב"התקציב שלנו". כל הכבוד!', 'הצעד הבא הוא זה שמפעיל את הכל: להעלות פירוט אשראי. המערכת קוראת וממיינת לבד, ותוך דקה רואים לאן הלך הכסף.', EASY, 'כמה טיפים:', TIP_MONTHS, TIP_CARDS, TIP_CASH, NOSTATE],
    button: 'להשלים את הפירוטים',
    action: 'picture'
  },
  more: {
    title: 'העלו פירוט, פחות מ-6 חודשים',
    subject: '3 טיפים שיעשו את התקציב שלך מדויק באמת',
    body: ['ראינו שכבר העלית פירוט ל"התקציב שלנו". מעולה!', 'כדי שהמערכת והיועץ יוכלו לעזור לך באמת, הם צריכים לראות את התמונה המלאה.', EASY, 'שלושה טיפים:', TIP_MONTHS.replace('להעלות פירוט של 3 עד 6 החודשים האחרונים', 'להוסיף עוד חודשים אחורה, כך שיהיו בסך הכל 3 עד 6 חודשים'), TIP_CARDS, TIP_CASH],
    button: 'להשלים את התמונה',
    action: 'picture'
  },
  fixed: {
    title: 'קובץ האקסל שלהם נקרא כ"ריק" (תיקנו)',
    subject: 'תיקנו: אפשר להעלות שוב את קובץ האקסל',
    body: ['ניסית להעלות ל"התקציב שלנו" פירוט באקסל, וקיבלת הודעה שהקובץ ריק או לא קריא.', 'זו הייתה תקלה אצלנו, לא בקובץ שלך: חלק מקבצי האקסל שבנקים וחברות אשראי מפיקים לא נקראו כמו שצריך. תיקנו את זה, ועכשיו הם נקראים כרגיל.', 'אפשר להעלות שוב בדיוק את אותו קובץ. מה שכבר נשמר לא ייכנס פעמיים.', 'סליחה על הטרחה, ותודה על הסבלנות.'],
    button: 'להעלות שוב',
    action: 'import'
  },
  nudge: {
    title: 'נכנסו ולא העלו פירוט (מכתב אישי עם תמונה)',
    subject: 'דקה אחת, והתמונה שלך מוכנה',
    body: ['ראינו שפתחת את "התקציב שלנו", ועוד לא העלית פירוט. זה בסדר גמור, רוב האנשים נתקעים בדיוק כאן.', 'רצינו להראות לך כמה זה קצר: מורידים את פירוט כרטיס האשראי מהאתר של החברה (PDF או אקסל), מעלים אותו, ותוך דקה כל התנועות כבר ממוינות לבד. ככה זה נראה:', '[img]', '• לא צריך להקליד כלום, ולא צריך לסדר את הקובץ.', '• אם משהו כבר במערכת, הוא לא נכנס פעמיים.', '• האפליקציה מראה לכל בנק ולכל חברת אשראי, צעד אחר צעד, איך מורידים את הפירוט.', NOSTATE],
    button: 'להעלות פירוט עכשיו',
    action: 'import',
    image: { src: '/mail/upload-sorted.png', alt: 'פירוט אשראי אחרי ההעלאה: כל התנועות ממוינות לקטגוריות', w: 280 }
  },
  picture: {
    title: 'חדש: השלמת התמונה (למי שהתחיל, פחות מ-6 חודשים)',
    subject: 'חדש: להשלים את הפירוטים בקלות, צעד אחר צעד',
    body: ['רצינו לספר לך על משהו חדש ב"התקציב שלנו": עשינו את השלמת הפירוטים הרבה יותר פשוטה.', '• בוחרים פעם אחת את הבנק ואת כרטיסי האשראי שלכם, לפי הלוגו. לא צריך להקליד כלום.', '• רואים בדיוק איזה פירוט חסר ולאיזה חודש, ומה כבר הועלה.', '• ליד כל פירוט שחסר יש הסבר קצר, צעד אחר צעד, איך מורידים אותו מהאתר של הבנק או של חברת האשראי.', '• מעלים את הקובץ כמו שהוא (PDF או אקסל), והמערכת קוראת וממיינת לבד.', 'וכל חודש נזכיר לך בעדינות מה חסר, כדי שהתמונה תישאר מלאה והיועץ יוכל לעזור באמת.', NOSTATE],
    button: 'להשלים את התמונה',
    action: 'picture'
  }
};
function campaignMail(campaign, link, unsubLink) {
  const m = MAILS[campaign];
  if (!m) return null;
  // The button opens the right place in the app (e.g. completing the picture).
  // The button opens the right place, and says which email it came from
  // (counted as a click, with the person's consent to usage counts).
  const base = String(link).replace(/\/?$/, '/');
  const go = base + '?' + (m.action ? 'action=' + m.action + '&' : '') + 'm=' + campaign;
  const sign = 'אם משהו לא עבד או לא היה ברור, אפשר פשוט לענות למייל הזה. אנחנו קוראים כל תשובה.';
  const text = 'היי,\n' + m.body.filter((l) => l !== '[img]').join('\n') + '\n\n' + m.button + ': ' + go + '\n\n' + sign + '\nצוות התקציב שלנו\n\n' + (unsubLink ? 'לא רוצה לקבל עוד מיילים כאלה? להסרה: ' + unsubLink : 'לא רוצה לקבל עוד מיילים? תענה "הסר".');
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
  const origin = String(link).replace(/\/app\/?$/, '');
  for (const line of m.body) {
    if (line === '[img]') {
      flush();
      if (m.image) body += '<p style="margin:0 0 16px;text-align:center"><a href="' + go + '"><img src="' + origin + m.image.src + '" width="' + m.image.w + '" alt="' + m.image.alt + '" style="max-width:100%;height:auto;border:1px solid #E7DCCD;border-radius:16px"></a></p>';
      continue;
    }
    if (line.startsWith('• ')) list.push(line.slice(2));
    else { flush(); body += '<p style="' + P + '">' + line + '</p>'; }
  }
  flush();
  const html = '<!doctype html><html lang="he" dir="rtl"><body style="margin:0;padding:0;background:#F3EDE6">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EDE6"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;text-align:right">'
    + '<tr><td style="padding:0 4px 14px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
    + '<td><img src="' + origin + '/wallet-192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px"></td>'
    + '<td style="padding-right:10px;font-size:19px;font-weight:bold;color:#2B2118">התקציב שלנו</td></tr></table></td></tr>'
    + '<tr><td style="background:#FFFFFF;border-radius:18px;padding:28px 26px;box-shadow:0 1px 3px rgba(0,0,0,.06)">'
    + '<p style="margin:0 0 14px;font-size:20px;font-weight:bold;color:#2B2118">היי,</p>' + body
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="background:#92490A;border-radius:12px">'
    + '<a href="' + go + '" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none">' + m.button + '</a></td></tr></table>'
    + '<p style="margin:0;font-size:15px;line-height:1.6;color:#5B4B3D">' + sign + '</p>'
    + '<p style="margin:10px 0 0;font-size:15px;font-weight:bold;color:#2B2118">צוות התקציב שלנו</p></td></tr>'
    + '<tr><td style="padding:16px 8px 0;font-size:13px;line-height:1.7;color:#8A7B6E;text-align:center">קיבלת את המייל כי נרשמת ל"התקציב שלנו".<br>לא רוצה לקבל עוד מיילים כאלה? ' + (unsubLink ? '<a href="' + escHtml(unsubLink) + '" style="color:#92490A;font-weight:bold;text-decoration:underline">להסרה לחץ כאן</a>' : 'תענה "הסר".') + '</td></tr>'
    + '</table></td></tr></table></body></html>';
  return { subject: m.subject, text, html };
}
// What came of each email we sent: when the person clicked its button (an
// entry to the app from it, after it), and when they uploaded a statement
// in the two weeks after it (nothing for one that did not go). Pure.
const UPLOAD_WINDOW = 14 * DAY;
function mailOutcomes({ sent = [], clicks = [], uploads = [] }) {
  const byUser = (list) => { const m = new Map(); for (const e of list) { if (!m.has(e.user_id)) m.set(e.user_id, []); m.get(e.user_id).push(e); } return m; };
  const clicksOf = byUser(clicks);
  const uploadsOf = byUser(uploads);
  const firstAfter = (list, t, until, name) => (list || []).filter((e) => (!name || e.name === name) && new Date(e.at).getTime() >= t && new Date(e.at).getTime() <= until).sort((a, b) => (a.at < b.at ? -1 : 1))[0];
  return sent.filter((r) => r.sent_at).map((r) => {
    const t = new Date(r.sent_at).getTime();
    const ok = r.ok !== false;
    const c = ok ? firstAfter(clicksOf.get(r.user_id), t, Infinity, 'mail_click_' + r.campaign) : null;
    const u = ok ? firstAfter(uploadsOf.get(r.user_id), t, t + UPLOAD_WINDOW) : null;
    return { user_id: r.user_id, campaign: r.campaign, at: r.sent_at, ok, clicked: c ? c.at : null, uploaded: u ? u.at : null };
  });
}
// The four numbers at the top of the email board: sent this month, how many
// clicked, how many uploaded a statement after an email, who asked to stop.
// People, not emails, for "uploaded" and "stopped". Pure.
function mailKpis({ sent = [], clicks = [], uploads = [], stopped = [], now = new Date() }) {
  const out = mailOutcomes({ sent, clicks, uploads }).filter((r) => CAMPAIGNS.includes(r.campaign));
  const monthStart = israelDay(now).slice(0, 8) + '01';
  const month = out.filter((r) => israelDay(new Date(r.at)) >= monthStart);
  const went = out.filter((r) => r.ok);
  const people = new Set(went.map((r) => r.user_id));
  const uploaded = new Set(went.filter((r) => r.uploaded).map((r) => r.user_id));
  const off = stopped.filter((id) => people.has(id)).length;
  const pct = (n, of) => (of ? Math.round((n / of) * 100) : null);
  return {
    month: { sent: month.filter((r) => r.ok).length, failed: month.filter((r) => !r.ok).length },
    clicked: went.filter((r) => r.clicked).length, went: went.length, clickPct: pct(went.filter((r) => r.clicked).length, went.length),
    uploaded: uploaded.size, people: people.size,
    stopped: stopped.length, stoppedPct: pct(off, people.size)
  };
}
// Per email: how many clicked and how many uploaded after it. Pure.
function campaignResults(args) {
  const res = {};
  for (const r of mailOutcomes(args)) {
    if (!r.ok || !CAMPAIGNS.includes(r.campaign)) continue;
    const c = res[r.campaign] || (res[r.campaign] = { clicked: 0, uploaded: 0 });
    if (r.clicked) c.clicked++;
    if (r.uploaded) c.uploaded++;
  }
  return res;
}
// The owner's history of our emails: who got which and when, whether it
// went, whether they clicked its button after it, whether they uploaded a
// statement after it, and who asked to stop. People are shown by first name
// (or a code) and a masked address. Pure.
function mailHistory({ sent = [], clicks = [], uploads = [], stops = [], users = [], names = {}, alias = (id) => id.slice(0, 6) }) {
  const email = new Map(users.map((u) => [u.id, u.email]));
  const who = (id) => ({ name: names[id] || '', code: alias(id), email: maskEmail(email.get(id) || '') });
  const rows = mailOutcomes({ sent, clicks, uploads }).map((r) => ({ ...who(r.user_id), campaign: r.campaign, title: MAILS[r.campaign] ? MAILS[r.campaign].title : askedFor(r.campaign) ? 'סיכום חודשי' : r.campaign, at: r.at, ok: r.ok, clicked: r.clicked, uploaded: r.uploaded }))
    .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 300);
  const stopped = stops.map((s) => ({ ...who(s.user_id), at: s.updated_at || null })).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const byCampaign = {};
  for (const r of rows) {
    const c = byCampaign[r.campaign] || (byCampaign[r.campaign] = { title: r.title, sent: 0, failed: 0, clicked: 0, uploaded: 0 });
    if (r.ok) c.sent++; else c.failed++;
    if (r.clicked) c.clicked++;
    if (r.uploaded) c.uploaded++;
  }
  return { rows, stopped, byCampaign };
}
// Why an email did not go, in words the owner can act on.
function mailErrorText(err) {
  const m = String((err && err.message) || err || '');
  if (/No email provider/i.test(m)) return 'השרת לא מחובר לשום שירות לשליחת מיילים (לא Resend ולא Gmail/SMTP).';
  if (/only send testing emails|verify a domain|not verified/i.test(m)) return 'Resend מוגדר רק במצב ניסיון: הוא שולח רק לכתובת שפתחה את חשבון ה-Resend. צריך לחבר דומיין, או לשלוח דרך Gmail.';
  if (/Invalid login|Username and Password not accepted|EAUTH|535/i.test(m)) return 'הכניסה לחשבון המייל נכשלה: הסיסמה (סיסמת האפליקציה של Gmail) לא נכונה.';
  if (/brevo:.*(sender|not valid|not verified)/i.test(m)) return 'Brevo לא מכיר את כתובת השולח: צריך לאשר אותה ב-Brevo (Senders), או לתקן את BREVO_FROM.';
  if (/brevo:.*(key|unauthorized|401)/i.test(m)) return 'מפתח ה-Brevo לא נכון (BREVO_API_KEY).';
  if (/smtp:.*(ETIMEDOUT|ECONNREFUSED|timeout)/i.test(m)) return 'השרת חוסם שליחה דרך Gmail/SMTP (בתוכנית החינמית של Render). צריך לחבר את Brevo.';
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout/i.test(m)) return 'לא הצלחנו להתחבר לשרת המיילים. נסו שוב בעוד רגע.';
  return 'השליחה נכשלה: ' + m.slice(0, 160);
}
function reengageMail(link) { return campaignMail('start', link); }
const campaignTitle = (c) => (MAILS[c] ? MAILS[c].title : '');
// The picture inside an email, if it has one (for its thumbnail on the board).
const campaignImage = (c) => (MAILS[c] && MAILS[c].image ? MAILS[c].image.src : null);

// Can the server email people? Resend's shared test address only delivers to
// the Resend account's own email, so it does not count.
// SMTP is listed but not counted: Render's free plan blocks it.
function mailReady({ brevo = false, resendKey = '', resendFrom = '', smtp = false } = {}) {
  const resend = !!resendKey && !/@resend\.dev>?\s*$/i.test(String(resendFrom));
  return { ready: !!brevo || resend, brevo: !!brevo, smtp: !!smtp, resend, resendTestOnly: !!resendKey && !resend };
}


// ── Two-step login by email: a 6-digit code, kept only as a hash ──
const crypto = require('crypto');
function tokenClaims(token) {
  try { const c = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()); return { sub: c.sub || null, aal: c.aal || 'aal1', sessionId: c.session_id || null }; } catch (_e) { return { sub: null, aal: 'aal1', sessionId: null }; }
}
function makeCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
function hashCode(code, userId, salt = '') { return crypto.createHash('sha256').update(String(salt) + ':' + String(userId) + ':' + String(code)).digest('hex'); }
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 5;
// 'ok' | 'missing' | 'expired' | 'locked' | 'wrong' (a wrong guess counts a try)
function checkCode(row, code, { userId, salt = '', purpose = null, now = Date.now() } = {}) {
  if (!row || (purpose && row.purpose !== purpose)) return 'missing';
  if (new Date(row.expires_at).getTime() <= now) return 'expired';
  if ((row.attempts || 0) >= CODE_TRIES) return 'locked';
  const given = hashCode(String(code || '').replace(/\D/g, ''), userId, salt);
  const a = Buffer.from(given), b = Buffer.from(String(row.code_hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'wrong';
}
const CODE_ERRORS = { missing: 'אין קוד פעיל. שלחו קוד חדש.', expired: 'הקוד פג (10 דקות). שלחו קוד חדש.', locked: 'יותר מדי ניסיונות. שלחו קוד חדש.', wrong: 'הקוד לא נכון. נסו שוב.' };
function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!d) return '';
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d;
}
function codeMail(code, purpose = 'login') {
  const what = purpose === 'enable' ? 'להפעלת כניסה בשני שלבים' : 'לכניסה לחשבון';
  const subject = code + ' הוא הקוד שלך ' + what;
  const text = 'הקוד שלך ' + what + ' ב"התקציב שלנו": ' + code + '\n\nהקוד בתוקף ל-10 דקות. אם לא ביקשתם אותו, אפשר להתעלם מהמייל, ולשנות סיסמה ליתר ביטחון.';
  const html = '<!doctype html><html lang="he" dir="rtl"><body style="margin:0;padding:24px 12px;background:#F3EDE6;font-family:Arial,Helvetica,sans-serif">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:16px"><tr><td style="padding:26px 24px;text-align:right">'
    + '<p style="margin:0 0 10px;font-size:16px;color:#2B2118">הקוד שלך ' + what + ':</p>'
    + '<p dir="ltr" style="margin:0 0 14px;font-size:34px;font-weight:bold;letter-spacing:8px;color:#2B2118;text-align:center">' + code + '</p>'
    + '<p style="margin:0;font-size:14px;line-height:1.6;color:#5B4B3D">הקוד בתוקף ל-10 דקות. אם לא ביקשתם אותו, אפשר להתעלם מהמייל, ולשנות סיסמה ליתר ביטחון.</p>'
    + '</td></tr></table></body></html>';
  return { subject, text, html };
}

// ── Emails with the app's look: the shell, the monthly summary, an answer ──
const escHtml = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nis = (n) => '₪' + Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-US');
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const monthName = (ym) => MONTHS_HE[Number(String(ym).slice(5, 7)) - 1] || '';

function mailShell({ origin, inner, footer }) {
  return '<!doctype html><html lang="he" dir="rtl"><body style="margin:0;padding:0;background:#F3EDE6">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EDE6"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;text-align:right">'
    + '<tr><td style="padding:0 4px 14px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>'
    + '<td><img src="' + origin + '/wallet-192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px"></td>'
    + '<td style="padding-right:10px;font-size:19px;font-weight:bold;color:#2B2118">התקציב שלנו</td></tr></table></td></tr>'
    + '<tr><td style="background:#FFFFFF;border-radius:18px;padding:28px 26px;box-shadow:0 1px 3px rgba(0,0,0,.06)">' + inner + '</td></tr>'
    + '<tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.7;color:#8A7B6E;text-align:center">' + footer + '</td></tr>'
    + '</table></td></tr></table></body></html>';
}
const mailButton = (href, label) => '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr><td style="background:#92490A;border-radius:12px">'
  + '<a href="' + escHtml(href) + '" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none">' + label + '</a></td></tr></table>';

// One link per person that turns the monthly email off, without signing in.
// kind: 'monthly' (the monthly summary) or 'news' (the getting-started emails).
const UNSUB_KINDS = ['monthly', 'news'];
function unsubToken(userId, secret, kind = 'monthly') { return crypto.createHmac('sha256', String(secret || 'x')).update(kind + ':' + String(userId)).digest('hex').slice(0, 32); }
function unsubOk(userId, token, secret, kind = 'monthly') {
  if (!UNSUB_KINDS.includes(kind)) return false;
  if (!/^[0-9a-f-]{36}$/i.test(String(userId || '')) || !/^[0-9a-f]{32}$/.test(String(token || ''))) return false;
  const a = Buffer.from(unsubToken(userId, secret, kind)), b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// What stands out in a month, from the report's numbers. Pure.
function monthInsights(d) {
  const out = { headline: '', subject: '', lines: [] };
  const name = monthName(d.month);
  const prevName = monthName(d.prev && d.prev.month ? d.prev.month : (() => { const x = new Date(String(d.month) + '-15T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() - 1); return x.toISOString().slice(0, 7); })());
  if (d.income > 0 && d.balance >= 0) { out.headline = 'נשארו לכם ' + nis(d.balance) + ' ב' + name; out.subject = name + ' שלכם: נשארו ' + nis(d.balance); }
  else if (d.income > 0) { out.headline = 'הוצאתם ' + nis(d.balance) + ' יותר ממה שנכנס ב' + name; out.subject = name + ' שלכם: חריגה של ' + nis(d.balance); }
  else { out.headline = 'הוצאתם ' + nis(d.expense) + ' ב' + name; out.subject = name + ' שלכם: הוצאתם ' + nis(d.expense); }
  const pe = d.prev && d.prev.expense;
  if (pe > 0 && d.expense > 0) {
    const pct = Math.round((d.expense - pe) / pe * 100);
    if (pct <= -3) out.lines.push('הוצאתם ' + Math.abs(pct) + '% פחות מאשר ב' + prevName + '. כל הכבוד!');
    else if (pct >= 3) out.lines.push('הוצאתם ' + pct + '% יותר מאשר ב' + prevName + '.');
    else out.lines.push('הוצאתם בערך כמו ב' + prevName + '.');
  }
  const cats = (d.topCategories || []).filter((c) => c.prev > 0);
  const up = cats.map((c) => ({ ...c, diff: c.amount - c.prev })).filter((c) => c.diff >= Math.max(200, c.prev * 0.15)).sort((a, b) => b.diff - a.diff)[0];
  const down = cats.map((c) => ({ ...c, diff: c.prev - c.amount })).filter((c) => c.diff >= Math.max(200, c.prev * 0.15)).sort((a, b) => b.diff - a.diff)[0];
  if (up) out.lines.push('הקפיצה הכי גדולה: ' + up.name + ', ' + nis(up.diff) + ' יותר מהחודש שלפני.');
  if (down) out.lines.push('חסכתם הכי הרבה ב' + down.name + ': ' + nis(down.diff) + ' פחות.');
  return out;
}

function monthlyMail(d, { link, unsubLink }) {
  const origin = String(link).replace(/\/app\/?.*$/, '');
  const ins = monthInsights(d);
  const name = monthName(d.month);
  const P = 'margin:0 0 12px;font-size:16px;line-height:1.65;color:#2B2118';
  const good = d.income > 0 && d.balance >= 0;
  let inner = '<p style="margin:0 0 6px;font-size:14px;color:#8A7B6E">הסיכום של ' + escHtml(name + ' ' + String(d.month).slice(0, 4)) + '</p>'
    + '<p style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:bold;color:' + (good || !(d.income > 0) ? '#2B2118' : '#A3361A') + '">' + escHtml(ins.headline) + '</p>';
  if (d.income > 0) {
    inner += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#FBF4EA;border-radius:12px"><tr>'
      + '<td style="padding:12px 14px;font-size:13px;color:#5B4B3D">נכנס<br><b style="font-size:18px;color:#2F6B4F">' + nis(d.income) + '</b></td>'
      + '<td style="padding:12px 14px;font-size:13px;color:#5B4B3D">יצא<br><b style="font-size:18px;color:#2B2118">' + nis(d.expense) + '</b></td></tr></table>';
  }
  for (const l of ins.lines) inner += '<p style="' + P + '">' + escHtml(l) + '</p>';
  const top = (d.topCategories || []).slice(0, 3);
  if (top.length) {
    inner += '<p style="margin:6px 0 8px;font-size:15px;font-weight:bold;color:#2B2118">לאן הלך הכי הרבה</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">'
      + top.map((c) => '<tr><td style="padding:6px 0;font-size:15px;color:#2B2118;border-bottom:1px solid #EFE7DC">' + escHtml(c.name) + '</td><td style="padding:6px 0;font-size:15px;font-weight:bold;color:#2B2118;text-align:left;border-bottom:1px solid #EFE7DC">' + nis(c.amount) + '</td></tr>').join('')
      + '</table>';
  }
  if (d.narrative) inner += '<p style="' + P + '">' + escHtml(d.narrative) + '</p>';
  const recs = (d.recommendations || []).filter(Boolean).slice(0, 3);
  if (recs.length) {
    inner += '<p style="margin:6px 0 8px;font-size:15px;font-weight:bold;color:#2B2118">3 דברים לחודש הבא</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#FBF4EA;border-radius:12px">'
      + recs.map((r) => '<tr><td width="28" valign="top" style="padding:12px 14px 0 0;font-size:16px;color:#92490A">✓</td><td style="padding:12px 0 0 14px;font-size:15px;line-height:1.6;color:#2B2118">' + escHtml(r) + '</td></tr>').join('')
      + '<tr><td colspan="2" style="height:12px"></td></tr></table>';
  }
  const goals = (d.goals || []).filter((g) => g && g.name).slice(0, 2);
  if (goals.length) {
    inner += '<p style="margin:6px 0 8px;font-size:15px;font-weight:bold;color:#2B2118">היעדים שלכם</p>'
      + goals.map((g) => { const pct = Math.max(0, Math.min(100, Math.round(Number(g.pct) || 0))); return '<p style="margin:0 0 4px;font-size:14px;color:#2B2118">' + escHtml(g.name) + ' · ' + pct + '%</p>'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;background:#EFE7DC;border-radius:6px"><tr><td width="' + Math.max(pct, 1) + '%" style="height:8px;background:#2F6B4F;border-radius:6px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr></table>'; }).join('');
  }
  inner += '<p style="' + P + '">כשיגיע פירוט האשראי של ' + escHtml(name) + ', העלו אותו כדי שהמספרים יהיו מלאים.</p>'
    + mailButton(String(link).replace(/\/$/, '') + '/#/money/report', 'לדוח המלא באפליקציה');
  const footer = 'קיבלתם את המייל כי אתם משתמשים ב"התקציב שלנו". מגיע פעם בחודש.<br>'
    + '<a href="' + escHtml(unsubLink) + '" style="color:#8A7B6E">להפסיק לקבל את הסיכום החודשי</a> · אפשר גם בפרופיל באפליקציה.';
  const text = ins.headline + '\n\n' + ins.lines.join('\n') + (top.length ? '\n\nלאן הלך הכי הרבה:\n' + top.map((c) => '• ' + c.name + ': ' + nis(c.amount)).join('\n') : '')
    + (d.narrative ? '\n\n' + d.narrative : '') + (recs.length ? '\n\n3 דברים לחודש הבא:\n' + recs.map((r) => '• ' + r).join('\n') : '')
    + '\n\nלדוח המלא: ' + String(link).replace(/\/$/, '') + '/#/money/report\n\nלהפסיק לקבל את הסיכום החודשי: ' + unsubLink;
  return { subject: ins.subject, text, html: mailShell({ origin, inner, footer }) };
}

// The owner answered a request: the person gets the answer by email too.
function answerMail({ question, answer, link }) {
  const origin = String(link).replace(/\/app\/?.*$/, '');
  const inner = '<p style="margin:0 0 14px;font-size:20px;font-weight:bold;color:#2B2118">ענינו על הפנייה שלך</p>'
    + '<p style="margin:0 0 6px;font-size:13px;color:#8A7B6E">כתבת:</p>'
    + '<p style="margin:0 0 16px;padding:12px 14px;background:#FBF4EA;border-radius:12px;font-size:15px;line-height:1.6;color:#5B4B3D;white-space:pre-wrap">' + escHtml(String(question || '').slice(0, 600)) + '</p>'
    + '<p style="margin:0 0 6px;font-size:13px;color:#8A7B6E">התשובה:</p>'
    + '<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#2B2118;white-space:pre-wrap">' + escHtml(answer) + '</p>'
    + mailButton(link, 'לאפליקציה')
    + '<p style="margin:14px 0 0;font-size:15px;color:#5B4B3D">רוצה להוסיף משהו? אפשר לענות למייל הזה.</p>'
    + '<p style="margin:10px 0 0;font-size:15px;font-weight:bold;color:#2B2118">צוות התקציב שלנו</p>';
  return {
    subject: 'ענינו על הפנייה שלך ב"התקציב שלנו"',
    text: 'כתבת:\n' + String(question || '').slice(0, 600) + '\n\nהתשובה:\n' + answer + '\n\nלאפליקציה: ' + link + '\n\nצוות התקציב שלנו',
    html: mailShell({ origin, inner, footer: 'קיבלת את המייל כי שלחת פנייה מתוך האפליקציה.' })
  };
}

// "Someone joined thanks to you": to the person whose link a new account
// came from. Never says who joined. Pure.
function thanksMail({ joined = 1, link, unsubLink = '' }) {
  const origin = String(link).replace(/\/app\/?.*$/, '');
  const n = Math.max(1, Number(joined) || 1);
  const more = n > 1 ? 'עד היום הצטרפו בזכותך ' + n + ' אנשים.' : '';
  const body = ['מישהו שקיבל ממך את הקישור נרשם עכשיו ל"התקציב שלנו".', more, 'זה עוזר לנו מאוד, ומאפשר לנו להמשיך לשפר את האפליקציה בשבילכם.'].filter(Boolean);
  const inner = '<p style="margin:0 0 14px;font-size:20px;font-weight:bold;color:#2B2118">תודה ששיתפת!</p>'
    + body.map((t) => '<p style="margin:0 0 10px;font-size:16px;line-height:1.65;color:#2B2118">' + escHtml(t) + '</p>').join('')
    + mailButton(link, 'לאפליקציה')
    + '<p style="margin:14px 0 0;font-size:15px;font-weight:bold;color:#2B2118">צוות התקציב שלנו</p>';
  const off = unsubLink ? '<br>לא רוצה לקבל עוד מיילים כאלה? <a href="' + escHtml(unsubLink) + '" style="color:#92490A;font-weight:bold;text-decoration:underline">להסרה לחץ כאן</a>' : '';
  return {
    subject: 'מישהו הצטרף בזכותך ל"התקציב שלנו"',
    text: 'תודה ששיתפת!\n\n' + body.join('\n') + '\n\nלאפליקציה: ' + link + '\n\nצוות התקציב שלנו' + (unsubLink ? '\n\nלהסרה: ' + unsubLink : ''),
    html: mailShell({ origin, inner, footer: 'קיבלת את המייל כי שיתפת קישור לאפליקציה.' + off })
  };
}

// A draft answer to a request, for the owner to read, change and send. The
// owner says where things stand (fixed, being worked on…) and may add a few
// words; the draft is never sent by itself. Pure: builds the prompt.
const DRAFT_STATUS = {
  fixed: 'התקלה תוקנה. אמור שזה תוקן, מה בדיוק השתנה (לפי מה שכתב בעל האפליקציה, אם כתב), ושכדאי לסגור ולפתוח את האפליקציה מחדש כדי לקבל את הגרסה החדשה. בקש שיכתוב אם עדיין לא עובד.',
  working: 'עוד לא תוקן, אבל זה בטיפול. אמור שהבנו מה הבעיה ושאנחנו עובדים על זה, בלי להבטיח תאריך. אם יש דרך לעקוף את הבעיה בינתיים לפי המדריך, הצע אותה.',
  explain: 'זו לא תקלה: מסבירים איך עושים את מה שהוא מחפש. ענה לפי המדריך בלבד, בצעדים קצרים עם השמות המדויקים של הכפתורים, ואם צריך ציין איפה זה בטלפון ואיפה במחשב.',
  idea: 'זו הצעה לשיפור. תודה חמה, אמור שהרעיון נכנס לרשימה ושנעדכן כשזה יהיה, בלי להבטיח.',
  more: 'חסר מידע כדי לעזור. שאל שאלה אחת או שתיים קצרות שיעזרו להבין (למשל: באיזה מסך, מה ניסה לעשות, מה קרה, אפשר צילום מסך).'
};
// What the AI answered: the reply, and whether the request looks fixed.
function readDraft(raw) {
  const s = String(raw || '');
  const m = s.match(/\{[\s\S]*\}/);
  let j = null;
  try { j = m ? JSON.parse(m[0]) : null; } catch (_e) { j = null; }
  if (!j || !String(j.text || '').trim()) return { text: s.trim().slice(0, 1500), fixed: 'unknown', why: '' };
  return { text: String(j.text).trim().slice(0, 1500), fixed: ['yes', 'no'].includes(j.fixed) ? j.fixed : 'unknown', why: String(j.why || '').trim().slice(0, 300) };
}
function draftPrompt({ status, hint = '', kind = '', name = '', messages = [], guide = '', changes = [], facts = [], askedAt = '' }) {
  const how = DRAFT_STATUS[status];
  if (!how) return null;
  const thread = messages.map((m) => (m.author === 'owner' ? 'אנחנו' : m.author === 'note' ? null : (name || 'המשתמש')) + ': ' + String(m.text || '').slice(0, 1500))
    .filter((l) => !l.startsWith('null')).join('\n');
  return 'כתוב תשובה קצרה בעברית למשתמש באפליקציה "התקציב שלנו", בשם צוות האפליקציה (חותמים "צוות התקציב שלנו", בלי שם פרטי). '
    + 'חם, פשוט וענייני, 2–4 משפטים, בלי כותרות, בלי markdown ובלי חתימה (החתימה מתווספת לבד). '
    + (name ? 'פנה אליו בשמו הפרטי (' + String(name).slice(0, 40) + ') רק אם הוא נשמע כמו שם אמיתי. ' : '')
    + 'אל תמציא יכולות, מסכים או תאריכים שלא כתובים כאן. ענה רק על מה שנשאל בפנייה.\n'
    + 'סוג הפנייה: ' + ({ bug: 'תקלה', idea: 'רעיון', other: 'אחר' }[kind] || 'פנייה') + '.\n'
    + 'המצב: ' + how + '\n'
    + (String(hint).trim() ? 'מה שבעל האפליקציה רוצה להגיד (העיקר, השתמש בזה): ' + String(hint).trim().slice(0, 600) + '\n' : '')
    + (guide ? '\nהמדריך של האפליקציה (רק לפי זה מסבירים איך עושים דברים):\n' + guide + '\n' : '')
    + (changes.length ? '\nמה השתנה באפליקציה (תאריך: שינוי), החדש למעלה:\n' + changes.map((c) => c.date + ': ' + c.text).join('\n') + '\n' : '')
    + (facts.length ? '\nמה רואים אצל המשתמש עכשיו (מהנתונים, בלי סכומים):\n' + facts.map((f) => '- ' + f).join('\n') + '\n' : '')
    + (askedAt ? 'הפנייה נשלחה ב-' + String(askedAt).slice(0, 10) + '.\n' : '')
    + '\nהשיחה עד עכשיו:\n' + thread + '\n\n'
    + 'קודם בדוק, לפי רשימת השינויים ומה שרואים אצל המשתמש, האם מה שהוא כתב עליו באמת תוקן או קיים עכשיו: '
    + '"yes" אם יש שינוי שמתאים לפנייה (ותאריכו ביום הפנייה או אחריו) ואין סימן בנתונים שזה עדיין לא עובד; "no" אם אין שינוי כזה או שהנתונים מראים שהבעיה עדיין קיימת; "unknown" אם אי אפשר לדעת. '
    + 'כתוב את התשובה לפי המצב שבעל האפליקציה בחר, ואם הבדיקה סותרת אותו אל תטען שמשהו תוקן כשלא מצאת לזה סימן.\n'
    + 'ענה רק ב-JSON: {"fixed":"yes|no|unknown","why":"משפט אחד לבעל האפליקציה: מה מצאת (איזה שינוי ומתי, או מה בנתונים)","text":"התשובה למשתמש"}';
}

// ── request threads (a request, then messages both ways) ──
// A name to show the owner: the first name the person gave in the app, or
// their label when it looks like a username (the same rule as the app's).
function firstName(name) {
  const s = String(name || '').trim();
  if (!s || /[@\d]/.test(s)) return '';
  if (/^[a-z._-]+$/i.test(s) && s === s.toLowerCase()) return '';
  return s.split(/\s+/)[0].slice(0, 30);
}
const THREAD_STATUS = ['new', 'working', 'done', 'wontfix'];
// What the owner can do to a request. Returns { row, message, note } or null.
//   message: an answer to the person; close: true closes it (default),
//   false keeps it open for their reply ("ask them").
function ownerAction(body, now = new Date()) {
  const b = body || {};
  const at = now.toISOString();
  const row = {};
  const msg = String(b.message ?? '').replace(/\r/g, '').trim().slice(0, 2000);
  const note = String(b.note ?? '').replace(/\r/g, '').trim().slice(0, 1000);
  if (msg) {
    const close = b.close !== false;
    Object.assign(row, { last_at: at, last_by: 'owner', closed: close, status: close ? 'done' : 'working', owner_note: msg, owner_seen_at: at, helped: null });
  }
  if (THREAD_STATUS.includes(b.status)) { row.status = b.status; row.closed = b.status === 'done' || b.status === 'wontfix'; }
  if (typeof b.pinned === 'boolean') row.pinned = b.pinned;
  if (typeof b.archived === 'boolean') row.archived = b.archived;
  if (b.unread === true) row.owner_seen_at = null;
  if (b.seen === true) row.owner_seen_at = at;
  if (!msg && !note && !Object.keys(row).length) return null;
  row.updated_at = at;
  return { row, message: msg || null, note: note || null };
}
// The person's side: a reply (allowed while open, or once to reopen a
// closed request: "still not working"), or "it helped".
function userAction(body, thread, now = new Date()) {
  const b = body || {};
  const at = now.toISOString();
  if (b.helped === true) return { row: { helped: true, user_seen_at: at, updated_at: at }, message: null };
  if (b.seen === true) return { row: { user_seen_at: at }, message: null };
  const msg = String(b.message ?? '').replace(/\r/g, '').trim().slice(0, 2000);
  if (msg.replace(/\s/g, '').length < 2) return null;
  const reopen = !!(thread && thread.closed);
  return { row: { last_at: at, last_by: 'user', closed: false, status: reopen ? 'new' : (thread && thread.status) || 'new', user_seen_at: at, helped: reopen ? false : thread && thread.helped, updated_at: at }, message: msg, reopened: reopen };
}
// One request as the owner sees it: the person's first message, the
// messages and notes in order, unread (they wrote after you last looked),
// and whether they read your last answer.
// A picture attached to a request: a data URL of a real PNG, JPEG or WebP
// (checked by its first bytes, not by what it claims), at most 1.5MB.
// -> { buf, type, ext } or null. Pure.
const IMAGE_MAX = 1.5 * 1024 * 1024;
function feedbackImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > IMAGE_MAX) return null;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const webp = buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
  const type = png ? 'image/png' : jpg ? 'image/jpeg' : webp ? 'image/webp' : null;
  if (!type || type !== m[1]) return null;
  return { buf, type, ext: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type] };
}
// A stored picture's path: <request id>/<random>.<ext>, nothing else.
const IMAGE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

function threadView(f, messages = [], { name = '', label = '' } = {}) {
  const list = [{ author: 'user', text: f.text, created_at: f.created_at }, ...messages.map((m) => ({ author: m.author, text: m.text, created_at: m.created_at, image: m.image || null }))];
  const lastOwner = [...list].reverse().find((m) => m.author === 'owner');
  const unread = list.filter((m) => m.author === 'user' && (!f.owner_seen_at || m.created_at > f.owner_seen_at)).length;
  return {
    id: f.id, kind: f.kind, status: f.status, screen: f.screen, device: f.device, created_at: f.created_at,
    who: name || label, label, pinned: !!f.pinned, archived: !!f.archived, closed: !!f.closed, helped: f.helped ?? null,
    last_at: f.last_at || f.created_at, last_by: f.last_by || 'user', unread,
    readByUser: !!(lastOwner && f.user_seen_at && f.user_seen_at >= lastOwner.created_at),
    messages: list
  };
}

// ── how each person is doing (the owner's dashboard) ──
// One label per person, from what they did, never what they wrote:
// stuck at sign-up, no statement yet, gone quiet, an import that failed,
// high AI use, little data, or fine. reasons: short words for the owner.
function healthOf({ joined = null, lastSeen = null, inHousehold = false, txCount = 0, months = 0, imports = 0, importFails = 0, asked = 0, cost = 0, medianCost = 0, now = new Date() }) {
  const days = (iso) => (iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / DAY) : null);
  const quiet = days(lastSeen);
  const age = days(joined);
  const highAi = cost >= Math.max(1, medianCost * 3);
  const reasons = [];
  if (highAi) reasons.push('צריכת AI גבוהה ($' + (Math.round(cost * 100) / 100) + ' ב-30 יום)');
  if (importFails > 0 && imports === 0) reasons.push('העלאת פירוט נכשלה');
  if (!inHousehold) return { level: 'stuck', label: 'נרשם ולא סיים הרשמה', reasons: [age !== null ? 'נרשם לפני ' + age + ' ימים' : '', ...reasons].filter(Boolean) };
  if (txCount === 0) return { level: 'stuck', label: 'לא העלה אף פירוט', reasons };
  if (quiet !== null && quiet >= 14) return { level: 'gone', label: 'לא נכנס ' + quiet + ' ימים', reasons };
  if (lastSeen === null && (age === null || age > 30)) return { level: 'gone', label: 'לא נכנס יותר מחודש', reasons };
  if (highAi || (importFails > 0 && imports === 0)) return { level: 'watch', label: 'כדאי לבדוק', reasons };
  if (months < 3) return { level: 'watch', label: 'מעט נתונים (' + months + ' חודשים)', reasons: ['כדאי להעלות עוד חודשים', ...reasons] };
  return { level: 'good', label: asked > 0 ? 'משתמש פעיל, נעזר ביועץ' : 'משתמש פעיל', reasons };
}

// Today (Israel time), one row per person who opened the app or signed up:
// when, what they did, AI use and failures.
// Israel's clock, summer and winter alike.
const IL_PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function israelClock(now = new Date()) {
  const p = Object.fromEntries(IL_PARTS.formatToParts(now).map((x) => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute, hour: Number(p.hour) };
}
function israelDay(now = new Date()) { return israelClock(now).day; }
function todayRows({ users = [], events = [], calls = [], errors = [], now = new Date() }) {
  const day = israelDay(now);
  const onDay = (iso) => israelDay(new Date(iso)) === day;
  const hm = (iso) => israelClock(new Date(iso)).hm;
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { id, first: null, last: null, newToday: false, opens: 0, added: 0, imports: 0, importFails: 0, asked: 0, aiCalls: 0, cost: 0, errors: 0 });
    return rows.get(id);
  };
  for (const u of users) if (u.created_at && onDay(u.created_at)) row(u.id).newToday = true;
  for (const e of events) {
    if (!e.user_id || !onDay(e.at)) continue;
    const r = row(e.user_id);
    if (!r.first || e.at < r.first) r.first = e.at;
    if (!r.last || e.at > r.last) r.last = e.at;
    if (e.name === 'app_open') r.opens++;
    else if (e.name === 'tx_add') r.added++;
    else if (e.name === 'import_done') r.imports++;
    else if (e.name === 'import_fail') r.importFails++;
    else if (e.name === 'advisor_ask' || e.name === 'advisor_talk') r.asked++;
  }
  for (const c of calls) { if (!c.user_id || !onDay(c.at) || !rows.has(c.user_id)) continue; const r = rows.get(c.user_id); r.aiCalls++; r.cost += costOf(c); }
  for (const e of errors) { if (e.user_id && onDay(e.at) && rows.has(e.user_id)) rows.get(e.user_id).errors++; }
  return [...rows.values()].map((r) => ({ ...r, first: r.first ? hm(r.first) : null, last: r.last ? hm(r.last) : null, cost: Math.round(r.cost * 1000) / 1000 }))
    .sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')));
}

// The owner's evening email: the same sentence as "who came in today?",
// one line per person, and how many requests wait. Pure.
function ownerDigestMail({ day, summary, items = [], waiting = 0, link }) {
  const origin = String(link).replace(/\/app\/?.*$/, '');
  const dmy = String(day || '').split('-').reverse().join('.');
  const k = (x, one, many) => (!x ? '' : x === 1 ? one : x + ' ' + many);
  const did = (p) => [k(p.opens, 'כניסה אחת', 'כניסות'), k(p.imports, 'פירוט אחד', 'פירוטים'), k(p.importFails, 'פירוט אחד נכשל', 'פירוטים נכשלו'), k(p.added, 'הוספה אחת', 'הוספות'), k(p.asked, 'שאלה אחת ליועץ', 'שאלות ליועץ'), p.cost ? 'AI $' + Number(p.cost).toFixed(2) : '', k(p.errors, 'שגיאה אחת', 'שגיאות')].filter(Boolean).join(' · ') || 'רק נכנס';
  const nameOf = (p) => p.name || ('בלי שם ' + (p.who || ''));
  const needs = items.filter((p) => p.health && p.health.level !== 'good');
  const rows = items.slice(0, 30).map((p) => '<tr><td style="padding:8px 0;border-top:1px solid #F0E6DA;font-size:15px;line-height:1.5;color:#2B2118"><b>' + escHtml(nameOf(p)) + '</b>' + (p.newToday ? ' <span style="color:#92490A">(חדש היום)</span>' : '')
    + '<br><span style="color:#5B4B3D">' + escHtml(did(p)) + '</span>' + (p.health ? '<br><span style="color:#8A7B6E;font-size:13px">' + escHtml(p.health.label) + '</span>' : '') + '</td></tr>').join('');
  const inner = '<p style="margin:0 0 12px;font-size:20px;font-weight:bold;color:#2B2118">היום באפליקציה · ' + escHtml(dmy) + '</p>'
    + '<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#2B2118">' + escHtml(summary) + '</p>'
    + (waiting ? '<p style="margin:0 0 16px;padding:10px 14px;background:#FBF4EA;border-radius:12px;font-size:15px;color:#5B4B3D">' + (waiting === 1 ? 'פנייה אחת מחכה לתשובה.' : waiting + ' פניות מחכות לתשובה.') + '</p>' : '')
    + (rows ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">' + rows + '</table>' : '')
    + mailButton(link + '?go=profile/admin#/home', 'ללוח הבעלים');
  const subject = (items.length ? 'היום: ' + (items.length === 1 ? 'משתמש אחד נכנס' : items.length + ' משתמשים נכנסו') : 'היום: אף אחד לא נכנס')
    + (needs.length ? ', ' + (needs.length === 1 ? 'אחד צריך עזרה' : needs.length + ' צריכים עזרה') : '') + (waiting ? ', ' + (waiting === 1 ? 'פנייה אחת מחכה' : waiting + ' פניות מחכות') : '');
  const text = 'היום באפליקציה · ' + dmy + '\n\n' + summary + (waiting ? '\n' + waiting + ' פניות מחכות לתשובה.' : '') + '\n\n'
    + items.slice(0, 30).map((p) => '• ' + nameOf(p) + (p.newToday ? ' (חדש היום)' : '') + ': ' + did(p) + (p.health ? ' · ' + p.health.label : '')).join('\n') + '\n\nללוח הבעלים: ' + link + '?go=profile/admin#/home';
  return { subject, text, html: mailShell({ origin, inner, footer: 'סיכום יומי לבעל האפליקציה. החשבונות שלך לא נספרים.' }) };
}

// The owner: by address (the app's own mailbox, or what the server's settings
// name) or by a SHA-256 fingerprint of the email. Pure.
function isOwnerEmail(email, emails = [], hashes = []) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (emails.includes(e)) return true;
  return hashes.includes(require('crypto').createHash('sha256').update(e).digest('hex'));
}
module.exports = { isOwnerEmail, mailHistory, mailOutcomes, mailKpis, campaignResults, aiMonthlyLimit, AI_MONTHLY_DEFAULT, pageAll, mailedThisWeek, thanksMail, feedbackImage, IMAGE_PATH, IMAGE_MAX, readDraft, draftPrompt, DRAFT_STATUS, shareStats, refCode, campaignStats, israelClock, ownerDigestMail, healthOf, todayRows, israelDay, firstName, ownerAction, userAction, threadView, unsubToken, unsubOk, monthInsights, monthlyMail, answerMail, mailShell, escHtml, tokenClaims, makeCode, hashCode, checkCode, CODE_TTL_MS, CODE_TRIES, CODE_ERRORS, maskEmail, codeMail, mailErrorText, reengageList, reengageMail, campaignList, campaignMail, campaignTitle, campaignImage, mailReady, CAMPAIGNS, ON_BOARD, cleanFeedback, feedbackPatch, EVENTS, cleanErrors, cleanEvents, stats, sessionCache, tokenExp, aiCallRow, costOf, alias, perUser, presenceStore, daily, cohorts, uploadFunnel, weekOf };
