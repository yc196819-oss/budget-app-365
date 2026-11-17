// Which households the weekly jobs (the couple's check-in, the advisor's
// alerts) run for: one of its members opened the app in the last `days`
// days. A household nobody opens gets no AI call and no notification.
const ACTIVE_DAYS = 14;

function activeHouseholds(memberships, events, now = Date.now(), days = ACTIVE_DAYS) {
  const since = now - days * 86400000;
  const users = new Set((events || []).filter((e) => e && e.user_id && Date.parse(e.at) >= since).map((e) => e.user_id));
  return new Set((memberships || []).filter((m) => users.has(m.user_id)).map((m) => m.household_id));
}

// Reads what activeHouseholds needs. On a read error: every household (the
// jobs run as before rather than for nobody).
async function loadActive(db, days = ACTIVE_DAYS) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [{ data: mems, error: e1 }, { data: evs, error: e2 }] = await Promise.all([
    db.from('memberships').select('household_id,user_id'),
    db.from('app_events').select('user_id,at').eq('name', 'app_open').gte('at', since).limit(20000)
  ]);
  const all = [...new Set((mems || []).map((m) => m.household_id))];
  if (e1 || e2) return { all, active: new Set(all) };
  return { all, active: activeHouseholds(mems, evs, Date.now(), days) };
}

module.exports = { activeHouseholds, loadActive, ACTIVE_DAYS };
