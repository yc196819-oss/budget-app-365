// How long one small call from the server to the database takes, for the
// owner's dashboard: a "before" number for moving the server or the database
// closer to Israel. A few tries; the middle one (one slow try is noise).
async function measure(call, tries = 5, now = () => Date.now()) {
  const times = [];
  for (let i = 0; i < tries; i++) {
    const t0 = now();
    try { await call(); } catch (_e) { return null; }
    times.push(now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { ms: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1], tries: sorted.length };
}

module.exports = { measure };
