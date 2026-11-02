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
function perUser({ users = [], events = [], calls = [], now = new Date(), salt = '' }) {
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
    .map((r) => ({ ...r, id: undefined, who: alias(r.id, salt), lastSeen: r.lastSeen ? String(r.lastSeen).slice(0, 10) : null, cost: Math.round(r.cost * 1000) / 1000 }))
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

module.exports = { cleanFeedback, feedbackPatch, EVENTS, cleanErrors, cleanEvents, stats, sessionCache, tokenExp, aiCallRow, costOf, alias, perUser, presenceStore, daily };
