// The chains' logos, served from our own address (/api/chain-logo/<key>):
// the server fetches each one once from the chain's own site (the fixed list
// in public/app/src/domain/chainShops.js, nothing else) and keeps it in
// memory. A family's phone never calls the chains' sites, and the app's
// content policy stays "images from us only".

const path = require('path');
const { pathToFileURL } = require('url');

const MAX_BYTES = 600 * 1024;
const DAY = 86400000;
const TYPES = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

// Is what the chain's site answered a logo we can serve? An image of a known
// kind, not empty and not huge.
function acceptable(contentType, size) {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  return TYPES.test(t) && size > 0 && size <= MAX_BYTES ? t : null;
}

let LOGOS = null;
async function logos() {
  if (!LOGOS) LOGOS = (await import(pathToFileURL(path.join(__dirname, '..', 'public/app/src/domain/chainShops.js')).href)).LOGOS;
  return LOGOS;
}

// key → { type, body, at } (a failure is kept too, for an hour, as null body).
const cache = new Map();

async function fetchLogo(url, fetchImpl = fetch) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; budget-app logo fetch)', Accept: 'image/*' } });
    if (!r.ok) return null;
    const body = Buffer.from(await r.arrayBuffer());
    let type = acceptable(r.headers.get('content-type'), body.length);
    // Some sites serve an SVG as text/plain or octet-stream.
    if (!type && /\.svg(\?|$)/i.test(url) && body.length <= MAX_BYTES && /<svg[\s>]/i.test(body.slice(0, 2000).toString('utf8'))) type = 'image/svg+xml';
    return type ? { type, body } : null;
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function getLogo(key, { fetchImpl = fetch, now = Date.now() } = {}) {
  const map = await logos();
  const url = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  if (!url) return null;
  const had = cache.get(key);
  if (had && now - had.at < (had.body ? 7 * DAY : DAY / 24)) return had.body ? had : null;
  const got = await fetchLogo(url, fetchImpl);
  cache.set(key, { ...(got || { type: null, body: null }), at: now });
  return got ? cache.get(key) : null;
}

function handler(req, res) {
  const key = String(req.params.key || '');
  if (!/^[a-z0-9-]{2,40}$/.test(key)) return res.status(404).end();
  getLogo(key).then((l) => {
    if (!l) return res.status(404).end();
    res.setHeader('Content-Type', l.type);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // An SVG from another site runs nothing here.
    if (l.type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return res.end(l.body);
  }, () => res.status(404).end());
}

module.exports = { acceptable, getLogo, handler, _cache: cache };
