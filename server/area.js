// A family says where it lives (a settlement, and a neighborhood if it
// wants); we find, for every chain, the branch nearest to it. Pure.
//
// Settlements: their official numbers (as in the chains' branch lists),
// names and map locations, from server/data/places.json.
const { places: PLACES } = require('./data/places.json');

const norm = (s) => String(s || '').replace(/[״"׳'`\-–,.()]/g, ' ').replace(/\s+/g, ' ').trim();
// Names, longest first, so "קריית אתא" wins over "אתא" inside a longer text.
const NAMES = Object.entries(PLACES).map(([code, [name]]) => [norm(name), code]).filter(([n]) => n.length >= 2).sort((a, b) => b[0].length - a[0].length);
const BY_NAME = new Map(NAMES);

function place(code) {
  const p = PLACES[String(Number(code))];
  return p ? { code: String(Number(code)), name: p[0], lat: p[1], lon: p[2] } : null;
}
// A settlement by its name as typed ("בית שמש", "בני-ברק").
function placeByName(text) {
  const code = BY_NAME.get(norm(text));
  return code ? place(code) : null;
}
// Settlements whose name starts with (or holds) what was typed, for the
// box the family types into: at most 8.
function suggest(text) {
  const q = norm(text);
  if (q.length < 2) return [];
  const starts = NAMES.filter(([n]) => n.startsWith(q));
  const holds = NAMES.filter(([n]) => !n.startsWith(q) && n.includes(q));
  return [...starts.sort((a, b) => a[0].length - b[0].length), ...holds].slice(0, 8).map(([, code]) => place(code));
}

// Settlements whose name is also an everyday word in an address ("רחוב",
// "נווה"): found only by their number or the city field, never in free text.
const WORDS = new Set(['רחוב', 'נווה', 'תקומה', 'אמונים', 'ברכה'].map(norm));

// How chains write some places in a branch's name: short forms and other
// spellings, to the official name.
const ALIASES = [
  ['תל אביב', 'תל אביב - יפו'], ['ת א', 'תל אביב - יפו'],
  ['י ם', 'ירושלים'], ['פ ת', 'פתח תקווה'], ['פתח תקוה', 'פתח תקווה'], ['ראשלצ', 'ראשון לציון'], ['ראשל צ', 'ראשון לציון'],
  ['יוקנעם', 'יקנעם עילית'], ['יקנעם', 'יקנעם עילית'], ['סכנין', "סח'נין"], ['דיר חנא', 'דייר חנא'], ['יהוד', 'יהוד-מונוסון'],
  ['עקרון', 'קרית עקרון'], ['מודיעין', 'מודיעין-מכבים-רעות'], ['ביתר', 'ביתר עילית'], ['רמת אפעל', 'רמת גן'],
  ['נצרת עילית', 'נוף הגליל'], ['קרית גת', 'קרית גת'], ['קרית אתא', 'קרית אתא']
].map(([a, b]) => [norm(a), placeByName(b) && placeByName(b).code]).filter(([, c]) => c).sort((x, y) => y[0].length - x[0].length);

// Where a branch is: by the settlement number in the list; when a chain
// wrote none (0), by a settlement's name in the branch's name or address
// ("קריית" read as "קרית", as in the official names), then by a short form.
function storePlace(store) {
  if (/^\d+$/.test(String(store.city)) && Number(store.city) > 0) {
    const p = place(store.city);
    if (p) return p;
  }
  const byName = placeByName(store.city);
  if (byName) return byName;
  const text = ' ' + norm(store.name + ' ' + store.address).replace(/קריית/g, 'קרית') + ' ';
  // The longest name found wins ("תל אביב" over a street named "יבנה").
  let best = null;
  for (const [n, code] of [...NAMES, ...ALIASES]) {
    if (n.length < 3 || WORDS.has(n) || !text.includes(' ' + n + ' ')) continue;
    // "שדרות" followed by a name is a boulevard, not the town.
    if (n === 'שדרות' && /שדרות [א-ת]/.test(text) && !/שדרות $/.test(text.trimEnd() + ' ')) continue;
    if (!best || n.length > best[0].length) best = [n, code];
  }
  return best ? place(best[1]) : null;
}

// Distance in km between two points on the map.
function km(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// For each chain, its branch for this home: in the same settlement (one
// whose name or address holds the neighborhood first), otherwise the
// nearest within `maxKm`. Chains with nothing near are left out.
//   stores: [{ chain, chain_name, store_id, name, address, city }]
//   home: { code, hood }
function nearestStores(stores, home, { maxKm = 25 } = {}) {
  const at = place(home.code);
  if (!at) return [];
  const hoodWords = norm(home.hood).split(' ').filter((w) => w.length >= 2);
  const byChain = new Map();
  for (const s of stores) {
    const p = storePlace(s);
    if (!p) continue;
    const list = byChain.get(s.chain) || [];
    list.push({ ...s, place: p, km: p.code === at.code ? 0 : km(at, p) });
    byChain.set(s.chain, list);
  }
  const out = [];
  for (const [chain, list] of byChain) {
    const here = list.filter((s) => s.place.code === at.code);
    let pick = null, kind = '';
    if (here.length) {
      const inHood = hoodWords.length ? here.find((s) => { const t = norm(s.name + ' ' + s.address); return hoodWords.every((w) => t.includes(w)); }) : null;
      pick = inHood || here.slice().sort((a, b) => Number(a.store_id) - Number(b.store_id))[0];
      kind = inHood ? 'hood' : 'city';
    } else {
      const near = list.slice().sort((a, b) => a.km - b.km)[0];
      if (near && near.km <= maxKm) { pick = near; kind = 'near'; }
    }
    if (pick) out.push({ chain, chain_name: pick.chain_name || chain, store_id: pick.store_id, name: pick.name, address: pick.address, city: pick.place.name, km: Math.round(pick.km * 10) / 10, kind });
  }
  return out.sort((a, b) => a.km - b.km || String(a.chain_name).localeCompare(String(b.chain_name), 'he'));
}

// A chain's branch list with each branch number once: when a number is
// listed twice, the entry we can place on the map (a real settlement, a real
// address) is kept; an online warehouse or the head office last.
function uniqueStores(list) {
  const rank = (s) => (storePlace(s) ? 0 : 2) + (/אונליין|online|ראשית|מחסן|משרד/i.test(String(s.name || '')) ? 1 : 0);
  const best = new Map();
  for (const s of list || []) {
    const id = String(s.store_id);
    const cur = best.get(id);
    if (!cur || rank(s) < rank(cur)) best.set(id, s);
  }
  return [...best.values()];
}

module.exports = { place, placeByName, suggest, storePlace, km, nearestStores, uniqueStores };
