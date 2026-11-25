// Points on the map, for real distances between a family and a branch.
//
// A branch: its street address turned into a point by OpenStreetMap's free
// service (Nominatim). Its rules: one request a second at most, a name that
// says who we are, and results kept (we keep each point and ask again only
// when the address changes). Only branch addresses are ever sent.
//
// A family: the phone's location, rounded to 0.005 degrees (about 500 m)
// before it leaves the phone and again here. The exact spot is never kept.

const { place, km } = require('./area');

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const AGENT = 'BudgetApp/1.0 (household budget app, Israel; branch locations)';
// Israel, and around it: a point outside is a wrong answer.
const inIsrael = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 29 && lat <= 34 && lon >= 34 && lon <= 36;
// A branch's point is believed only near its settlement (the same street
// name is in many towns).
const NEAR_TOWN_KM = 8;
// A branch not found is asked about again after 30 days.
const RETRY_MS = 30 * 86400000;

// Rounded to 0.005 degrees (about 500 m): the only location of a family kept.
function roundHome(lat, lon) {
  const r = (x) => Math.round(Number(x) * 200) / 200;
  const a = r(lat), b = r(lon);
  return inIsrael(a, b) ? { lat: a, lon: b } : null;
}

// What we ask the map service for a branch: its street address and its
// settlement. None when the chain gave no real street address.
function geoQuery(store, town) {
  const street = String(store.address || '').replace(/\s+/g, ' ').trim();
  if (!town || street.length < 3 || /^(unknown|לא ידוע|0|-)$/i.test(street) || !/[א-תa-z]/i.test(street)) return null;
  // The settlement is said once, even when the address already holds it.
  const text = street.includes(town.name) ? street : street + ', ' + town.name;
  return text + ', ישראל';
}

// Whether a branch needs its point (again): a new address, or not found
// and 30 days have passed.
function needsPoint(store, q, now = Date.now()) {
  if (!q) return false;
  if (store.geo_q !== q) return true;
  if (store.lat != null) return false;
  return !store.geo_at || now - Date.parse(store.geo_at) > RETRY_MS;
}

// One address to a point, or null (not found, or not near its settlement).
async function lookUp(fetchFn, q, town) {
  const url = NOMINATIM + '?format=jsonv2&limit=1&countrycodes=il&accept-language=he&q=' + encodeURIComponent(q);
  const r = await fetchFn(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (r.status === 429 || r.status === 403) throw new Error('map service refused (' + r.status + ')');
  if (!r.ok) return null;
  const list = await r.json();
  const hit = Array.isArray(list) ? list[0] : null;
  if (!hit) return null;
  const p = { lat: Number(hit.lat), lon: Number(hit.lon) };
  if (!inIsrael(p.lat, p.lon)) return null;
  if (town && km(town, p) > NEAR_TOWN_KM) return null;
  return p;
}

// Points for the branches that need one, one a second, at most `max` this
// time (the rest next time). `townOf(store)` is the branch's settlement;
// `save(store, point|null, q)` keeps the answer. Stops at once if the
// service refuses us. Returns how it went.
async function locateStores(stores, { fetchFn, townOf, save, max = 800, wait = 1100, now = Date.now(), sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) }) {
  const out = { asked: 0, found: 0, left: 0, error: null };
  const todo = [];
  for (const s of stores) {
    const town = townOf(s);
    const q = geoQuery(s, town);
    if (needsPoint(s, q, now)) todo.push({ s, q, town });
  }
  for (const { s, q, town } of todo) {
    if (out.asked >= max) { out.left++; continue; }
    if (out.asked) await sleep(wait);
    out.asked++;
    let p = null;
    try { p = await lookUp(fetchFn, q, town); } catch (e) { out.error = String(e.message || e).slice(0, 120); out.left += todo.length - out.asked + 1; break; }
    if (p) out.found++;
    await save(s, p, q);
  }
  return out;
}

// The settlement whose center is nearest a point (for "use my location").
function placeAt(lat, lon, places) {
  let best = null;
  for (const code of Object.keys(places)) {
    const p = place(code);
    if (!p) continue;
    const d = km(p, { lat, lon });
    if (!best || d < best.d) best = { p, d };
  }
  return best && best.d <= 15 ? best.p : null;
}

module.exports = { roundHome, geoQuery, needsPoint, lookUp, locateStores, placeAt, inIsrael, AGENT };
