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
// Misses saved before this were partly the service slowing us down (it
// answered "nothing" for plain addresses): asked again once.
const MISSES_BEFORE = Date.parse('2026-11-27T12:00:00Z');
// This many misses in a row: the service is slowing us down, not a run of
// bad addresses. Stop, keep none of them, and go on the next night.
const MISS_STREAK = 20;

// A street as the chains write it, in the words the map knows: "שד." is
// שדרות, "ד." is דרך, "רח'" is dropped; quotes and stray commas cleaned.
function cleanStreet(text) {
  return (' ' + String(text || '') + ' ')
    .replace(/(^|[\s,])שד['׳.]\s*/g, '$1שדרות ')
    .replace(/(^|[\s,])ד['׳.]\s*/g, '$1דרך ')
    .replace(/(^|[\s,])רח(וב)?['׳.]?\s+/g, '$1')
    .replace(/(^|[\s,])(מול|ליד|פינת)\s+/g, '$1')
    .replace(/[״"]/g, '"')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    // Leftovers of the chains' files: an HTML code, a P.O. box, a house
    // number 0, a house number written twice ("הפסגה 39 39").
    .replace(/&#x?[0-9a-f]+;/gi, '')
    .replace(/ת\.?\s?ד\.?\s*\d+/g, '')
    .replace(/\s+0$/, '')
    .replace(/\b(\d+)\s+\1$/, '$1')
    .replace(/[\s,]+$/, '')
    .trim();
}

// Rounded to 0.005 degrees (about 500 m): the only location of a family kept.
function roundHome(lat, lon) {
  const r = (x) => Math.round(Number(x) * 200) / 200;
  const a = r(lat), b = r(lon);
  return inIsrael(a, b) ? { lat: a, lon: b } : null;
}

// What we ask the map service for a branch: its street address (cleaned)
// and its settlement. None when the chain gave no real street address.
function geoQuery(store, town) {
  const street = cleanStreet(store.address);
  if (!town || street.length < 3 || /^(unknown|לא ידוע|0|-)$/i.test(street) || !/[א-תa-z]/i.test(street)) return null;
  // The settlement is said once, even when the address already holds it.
  const text = street.includes(town.name) ? street : street + ', ' + town.name;
  return text + ', ישראל';
}

// Whether a branch needs its point (again): a new address; or not found,
// and 30 days have passed or it was missed before the fix above.
function needsPoint(store, q, now = Date.now()) {
  if (!q) return false;
  if (store.geo_q !== q) return true;
  if (store.lat != null) return false;
  if (!store.geo_at) return true;
  const at = Date.parse(store.geo_at);
  return at < MISSES_BEFORE || now - at > RETRY_MS;
}

// One request to the map service: the first answer, or null. An answer
// that is not a plain "here it is" or "nothing" stops the run (the service
// is busy or refusing us): nothing is saved, and the next night tries again.
async function ask(fetchFn, params) {
  const url = NOMINATIM + '?format=jsonv2&limit=1&countrycodes=il&accept-language=he&' + new URLSearchParams(params).toString();
  const r = await fetchFn(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('map service answered ' + r.status);
  const list = await r.json();
  return Array.isArray(list) && list[0] ? { lat: Number(list[0].lat), lon: Number(list[0].lon) } : null;
}
const believed = (p, town) => !!p && inIsrael(p.lat, p.lon) && (!town || km(town, p) <= NEAR_TOWN_KM);

// One branch to a point, or null (not found, or not near its settlement):
// first as a street and a city apart (the map reads that best), then as
// one line. `pause()` is waited between the two requests.
async function lookUp(fetchFn, q, town, store = null, pause = async () => {}) {
  if (store && town) {
    const street = cleanStreet(store.address).replace(new RegExp(',?\\s*' + town.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '');
    const p = await ask(fetchFn, { street, city: town.name, country: 'ישראל' });
    if (believed(p, town)) return p;
    await pause();
  }
  const p = await ask(fetchFn, { q });
  return believed(p, town) ? p : null;
}

// Points for the branches that need one, one request a second, at most
// `max` branches this time (the rest next time). `townOf(store)` is the
// branch's settlement; `save(store, point|null, q)` keeps the answer. A
// miss is kept only once a later branch is found (or at the end): a long
// run of misses means the service is slowing us down, so the run stops and
// those branches are asked again next time. Returns how it went.
async function locateStores(stores, { fetchFn, townOf, save, max = 1500, wait = 1100, streak = MISS_STREAK, now = Date.now(), sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) }) {
  const out = { asked: 0, found: 0, missed: 0, left: 0, error: null };
  const todo = [];
  for (const s of stores) {
    const town = townOf(s);
    const q = geoQuery(s, town);
    if (needsPoint(s, q, now)) todo.push({ s, q, town });
  }
  let misses = [];
  const keepMisses = async () => { for (const m of misses) { await save(m.s, null, m.q); out.missed++; } misses = []; };
  let i = 0;
  for (; i < todo.length && out.asked < max; i++) {
    const { s, q, town } = todo[i];
    if (out.asked) await sleep(wait);
    out.asked++;
    let p;
    try { p = await lookUp(fetchFn, q, town, s, () => sleep(wait)); } catch (e) { out.error = String(e.message || e).slice(0, 120); break; }
    if (!p) {
      misses.push({ s, q });
      if (misses.length >= streak) { out.error = streak + ' misses in a row: stopped'; break; }
      continue;
    }
    await keepMisses();
    out.found++;
    await save(s, p, q);
  }
  if (!out.error) await keepMisses();
  out.left = todo.length - out.found - out.missed;
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

module.exports = { cleanStreet, roundHome, geoQuery, needsPoint, lookUp, locateStores, placeAt, inIsrael, AGENT };
