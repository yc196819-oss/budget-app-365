// Operations: failures the app reports, usage events, and the numbers the
// owner looks at (who uses it, who comes back, what breaks). Pure.

// The only events kept: what someone did, never what they wrote or how much.
const EVENTS = ['app_open', 'tx_add', 'import_done', 'advisor_ask', 'advisor_talk', 'decision_open', 'decision_message', 'trip_plan', 'news_open', 'lesson_done', 'shortcut', 'export', 'restore'];
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

module.exports = { EVENTS, cleanErrors, cleanEvents, stats, sessionCache, tokenExp };
