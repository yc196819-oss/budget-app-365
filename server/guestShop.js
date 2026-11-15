// A shopping tab link for one person without an account: a secret in the
// link, only its fingerprint kept. Pure helpers (the server holds the rest).
const crypto = require('crypto');

// A new link's secret: 24 random bytes, safe in a URL.
const newToken = () => crypto.randomBytes(24).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
// The shape of a secret this server makes (anything else is not looked up).
const isToken = (t) => /^[A-Za-z0-9_-]{32}$/.test(String(t || ''));
// A name for the link, as the owner wrote it ("רינה מהשכונה").
const cleanLabel = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || 'קישור לקניות';
// What a guest may search: up to 15 short lines of text.
function cleanQueries(q) {
  if (!Array.isArray(q)) return [];
  return q.map((x) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, 15);
}
// The link as the owner's board shows it (never the secret or its fingerprint).
const forOwner = (r) => ({ id: r.id, label: r.label, created_at: r.created_at, revoked: !!r.revoked_at, last_used_at: r.last_used_at || null, uses: r.uses || 0 });

module.exports = { newToken, hashToken, isToken, cleanLabel, cleanQueries, forOwner };
