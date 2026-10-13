// Trips: found in the card lines, a folder for each, and a budget for the
// next one from the last one. Pure: no DOM, no network.
//   tx { id, tx_date: 'YYYY-MM-DD', description, amount (₪), type }
// A line is "abroad" when its name says where (a city, a country code at
// the end), or when it is a name in Latin letters on a day next to such a
// line (a shop in a small town the lists do not know). Online services and
// installment payments never are.

export const CATS = {
  flights: { label: 'טיסות', icon: '✈️' },
  lodging: { label: 'לינה', icon: '🏨' },
  food: { label: 'אוכל', icon: '🍽️' },
  transport: { label: 'תחבורה ורכב', icon: '🚕' },
  attractions: { label: 'אטרקציות', icon: '🎟️' },
  shopping: { label: 'קניות', icon: '🛍️' },
  other: { label: 'ביטוח, עמלות ושונות', icon: '🧾' }
};

const RULES = [
  ['flights', /WIZZ|RYANAIR|EASYJET|EL ?AL\b|אל על|ISRAIR|ישראייר|ARKIA|ארקיע|AEGEAN|LUFTHANSA|TURKISH AIR|PEGASUS|TAROM|BLUE ?BIRD|AIR ?FRANCE|KLM|AIRLINES|AIRWAYS|FLYDUBAI|SUNDOR|ISSTA|איסתא|GULLIVER|גוליבר|MYTRIP|KIWI\.COM|EDREAMS|LASTMINUTE|TRIP\.COM|SKYSCANNER|OPODO|FLYONE|SMARTWINGS/i],
  ['lodging', /BOOKING\.?COM|AIRBNB|HOTEL|HOSTEL|EXPEDIA|AGODA|HOTELS\.COM|RESORT|APARTHOTEL|PENSIUNE|מלון|VRBO/i],
  ['attractions', /MUSEUM|MUZEU|CASTLE|CASTEL|CETATE|TICKET|BILET|TOUR\b|TOURS|\bZOO\b|AQUA|THERME|SPA\b|PARADIS|SALIN|SALT ?MINE|TELECABIN|CABLE ?CAR|FUNICULAR|GETYOURGUIDE|TIQETS|KLOOK|THEATR|CINEMA|BOWLING|ESCAPE|TRICKSHOT|PARK\b|PALAT/i],
  ['transport', /UBER|BOLT|TAXI|GETT|RENT ?A ?CAR|RENTACAR|RENT AUTO|MIETWAGEN|CAR ?RENTAL|HERTZ|AVIS|SIXT|EUROPCAR|AUTONOM|BUDGET CAR|METRO|TRAIN|\bCFR\b|PARKING|PARCARE|חניון|נמל תעופה|PETROM|ROMPETROL|\bPECO\b|PETROL|\bOMV\b|\bMOL\b|SHELL|LUKOIL|GAZPROM|ROVINIETA|VIGNETTE|FERRY|BUS\b/i],
  ['shopping', /DUTY ?FREE|דיוטי|HEINEMANN|היינמן|JAMES RICHARDSON|AELIA|LAGARDERE|ZARA|STRADIVARIUS|H&M|PRIMARK|DECATHLON|MANGO|PULL ?& ?BEAR|BERSHKA|PEPCO|KIK\b|TEDI|LC WAIKIKI|NEW YORKER|RESERVED|C&A|MEDIA GALAXY|ALTEX|EMAG|DOUGLAS|SEPHORA|MALL|OUTLET|\bAFI\b/i],
  ['food', /RESTAURANT|RESTAURANTE|RISTORANTE|CAFE|COFFEE|STARBUCKS|BAR\b|PUB\b|PIZZ|BURGER|MCDONALD|KFC|BISTRO|TRATTORIA|TAVERN|CARU|SERGIANA|MEGA IMAGE|LIDL|KAUFLAND|CARREFOUR|SPAR\b|BILLA|PROFI|AUCHAN|PENNY|ALDI|TESCO|MARKET|SUPERMARKET|BAKERY|BAKERI|PATISSERIE|בייקרי/i],
  ['other', /ביטוח נסיעות|PASSPORTCARD|פספורט|עמלת המרה|עמלת חו|FX FEE|FOREIGN FEE/i]
];

// The household's own category, when the name says nothing.
const BY_CATEGORY = [
  ['food', /אוכל|מסעד|סופר|קפה/], ['transport', /רכב|דלק|תחבורה|חניה/], ['shopping', /ביגוד|אופנה|קניות|טיפוח|קוסמטיקה|טיפולים|ריהוט|עיצוב/],
  ['attractions', /פנאי|בידור|ספורט|תרבות/], ['lodging', /לינה|מלון/]
];

export function category(description, categoryName = '') {
  const d = String(description || '');
  for (const [cat, re] of RULES) if (re.test(d)) return cat;
  for (const [cat, re] of BY_CATEGORY) if (re.test(String(categoryName || ''))) return cat;
  return 'other';
}

// Booked weeks ahead (flights, lodging, insurance, car hire, tickets): up to
// 120 days before. Paid on the way (airport, duty free, the train there,
// conversion fees): only within 2 days of the trip.
const BOOKED = /WIZZ|RYANAIR|EASYJET|EL ?AL\b|אל על|ISRAIR|ישראייר|ARKIA|ארקיע|AEGEAN|LUFTHANSA|TURKISH AIR|PEGASUS|TAROM|BLUE ?BIRD|AIRLINES|AIRWAYS|FLYDUBAI|SUNDOR|ISSTA|איסתא|GULLIVER|גוליבר|MYTRIP|KIWI\.COM|EDREAMS|LASTMINUTE|TRIP\.COM|OPODO|BOOKING\.?COM|AIRBNB|HOTEL|EXPEDIA|AGODA|ביטוח נסיעות|PASSPORTCARD|פספורט|RENT ?A ?CAR|RENTACAR|RENT AUTO|MIETWAGEN|CAR ?RENTAL|HERTZ|AVIS|SIXT|EUROPCAR|AUTONOM|GETYOURGUIDE|TIQETS|KLOOK/i;
const ON_THE_WAY = /DUTY ?FREE|דיוטי|JAMES RICHARDSON|היינמן|HEINEMANN|נתב"?ג|BEN ?GURION|נמל תעופה|טרמינל|עמלת המרה|עמלת חו|מט"?ח|FX FEE/i;
export const isPrep = (description) => BOOKED.test(String(description || '')) || ON_THE_WAY.test(String(description || ''));

const COUNTRY_CODES = { RO: 'רומניה', GR: 'יוון', IT: 'איטליה', FR: 'צרפת', ES: 'ספרד', PT: 'פורטוגל', DE: 'גרמניה', AT: 'אוסטריה', HU: 'הונגריה', CZ: 'צ׳כיה', PL: 'פולין', NL: 'הולנד', BE: 'בלגיה', GB: 'אנגליה', UK: 'אנגליה', IE: 'אירלנד', CH: 'שווייץ', HR: 'קרואטיה', ME: 'מונטנגרו', BG: 'בולגריה', CY: 'קפריסין', TR: 'טורקיה', GE: 'גאורגיה', AE: 'דובאי', TH: 'תאילנד', US: 'ארה״ב', CA: 'קנדה', JP: 'יפן', MA: 'מרוקו', EG: 'מצרים', SE: 'שוודיה', DK: 'דנמרק', NO: 'נורווגיה', FI: 'פינלנד', SK: 'סלובקיה', SI: 'סלובניה', RS: 'סרביה', AL: 'אלבניה', LT: 'ליטא', LV: 'לטביה', EE: 'אסטוניה', MT: 'מלטה', IS: 'איסלנד', VN: 'וייטנאם', IN: 'הודו' };
const CITIES = [
  [/BUCUREST|BUCHAREST|SINAIA|BRASOV|CLUJ|OTOPENI|CONSTANTA|SIBIU|TIMISOARA|IASI|RASNOV|BRAN\b/i, 'רומניה'],
  [/ATHEN|ATHINA|THESSALONIKI|CRETE|HERAKLION|RHODES|RODOS|CORFU|KERKYRA|MYKONOS|SANTORINI|CHANIA/i, 'יוון'],
  [/ROMA\b|ROME|MILAN|VENEZIA|VENICE|FIRENZE|FLORENCE|NAPOLI|BOLOGNA|TORINO/i, 'איטליה'],
  [/PARIS|NICE\b|LYON|MARSEILLE/i, 'צרפת'],
  [/LONDON|MANCHESTER|EDINBURGH/i, 'אנגליה'],
  [/BARCELONA|MADRID|MALAGA|SEVILLA|VALENCIA|IBIZA|MALLORCA|PALMA/i, 'ספרד'],
  [/LISBOA|LISBON|PORTO\b/i, 'פורטוגל'],
  [/BUDAPEST/i, 'הונגריה'], [/PRAHA|PRAGUE/i, 'צ׳כיה'], [/WIEN|VIENNA/i, 'אוסטריה'],
  [/BERLIN|MUNCHEN|MUNICH|FRANKFURT|HAMBURG/i, 'גרמניה'], [/AMSTERDAM/i, 'הולנד'],
  [/TBILISI|BATUMI/i, 'גאורגיה'], [/ISTANBUL|ANTALYA/i, 'טורקיה'], [/DUBAI|ABU DHABI/i, 'דובאי'],
  [/BANGKOK|PHUKET|KOH /i, 'תאילנד'], [/NEW YORK|NYC|MIAMI|LOS ANGELES|LAS VEGAS/i, 'ארה״ב'],
  [/LARNACA|LIMASSOL|PAPHOS|AYIA NAPA/i, 'קפריסין'], [/SOFIA|BANSKO|BURGAS|VARNA/i, 'בולגריה'],
  [/SPLIT\b|DUBROVNIK|ZAGREB/i, 'קרואטיה'], [/BUDVA|KOTOR|PODGORICA/i, 'מונטנגרו']
];
const CURRENCY_COUNTRY = { RON: 'רומניה', HUF: 'הונגריה', CZK: 'צ׳כיה', PLN: 'פולין', GBP: 'אנגליה', GEL: 'גאורגיה', TRY: 'טורקיה', THB: 'תאילנד', AED: 'דובאי', CHF: 'שווייץ', BGN: 'בולגריה', JPY: 'יפן', RSD: 'סרביה', EGP: 'מצרים', MAD: 'מרוקו', SEK: 'שוודיה', DKK: 'דנמרק', NOK: 'נורווגיה', ISK: 'איסלנד', VND: 'וייטנאם', INR: 'הודו', CAD: 'קנדה' };

const latin = (d) => /[A-Za-z]/.test(d) && !/[֐-׿]/.test(d);
// Paid from home to a site abroad: not a sign of being there.
const ONLINE = /NETFLIX|SPOTIFY|GOOGLE|APPLE\.COM|ITUNES|MICROSOFT|ANTHROPIC|OPENAI|CHATGPT|AMAZON|ALIEXPRESS|SHEIN|TEMU|EBAY|PAYPAL|ZOOM|CANVA|ADOBE|DROPBOX|YOUTUBE|STEAM|PLAYSTATION|XBOX|WOLT|UBER ?EATS|IHERB|ASOS|PATREON|WIX|GODADDY|NAMECHEAP|CLOUDFLARE|DIGITALOCEAN|LINKEDIN|FACEBOOK|TIKTOK/i;

// Where it was paid, when the line says so: the country, or '' when foreign
// but unknown, or null when it looks like a purchase in Israel.
export function placeOf(tx) {
  const d = String(tx.description || '').trim();
  if (ONLINE.test(d) || /תשלום\s*\d+\s*מתוך/.test(d)) return null;
  const cur = String(tx.currency || '').toUpperCase();
  for (const [re, country] of CITIES) if (re.test(d)) return country;
  const code = d.match(/(?:\s|,)([A-Z]{2})\s*$/);
  if (code && COUNTRY_CODES[code[1]] && latin(d)) return COUNTRY_CODES[code[1]];
  if (CURRENCY_COUNTRY[cur]) return CURRENCY_COUNTRY[cur];
  if (cur && cur !== 'ILS' && cur !== '₪' && cur !== 'NIS') return '';
  if (/חו"?ל|חו״ל/.test(d)) return '';
  return null;
}

const dateOf = (t) => t.tx_date || t.date;
const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const iso = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const mostCommon = (list) => {
  const n = new Map();
  for (const x of list) if (x) n.set(x, (n.get(x) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

// Groups of purchases abroad a few days apart: at least 3 over at least 2
// days. Then the flights, lodging, insurance and car hire paid up to 120
// days before (or 2 days after) are added as "booked ahead". `skip` holds
// transaction ids already in a saved or dismissed trip.
export function detectTrips(txs, { gap = 3, ahead = 120, skip = new Set() } = {}) {
  const spent = txs.filter((t) => t.type !== 'income' && Number(t.amount) > 0 && dateOf(t) && !skip.has(t.id));
  const placed = spent.map((t) => ({ t, place: placeOf(t) })).filter((x) => x.place !== null);
  const sure = new Set(placed.filter((x) => x.place).map((x) => dateOf(x.t)));
  const near = (d) => [...sure].some((s) => Math.abs(day(s) - day(d)) <= 1);
  // A Latin name next to a day abroad is a shop there too.
  const neighbours = spent.filter((t) => !placed.some((x) => x.t === t) && latin(String(t.description || '')) && !ONLINE.test(t.description) && !isPrep(t.description) && near(dateOf(t)))
    .map((t) => ({ t, place: '' }));
  const abroad = [...placed, ...neighbours].sort((a, b) => (dateOf(a.t) < dateOf(b.t) ? -1 : 1));
  const groups = [];
  for (const x of abroad) {
    const g = groups.at(-1);
    if (g && day(dateOf(x.t)) - day(dateOf(g.at(-1).t)) <= gap) g.push(x);
    else groups.push([x]);
  }
  const used = new Set();
  const trips = [];
  for (const g of groups) {
    const start = dateOf(g[0].t), end = dateOf(g.at(-1).t);
    const known = g.filter((x) => x.place);
    if (g.length < 3 || day(end) - day(start) < 1 || !known.length) continue;
    const country = mostCommon(known.map((x) => x.place));
    const items = g.map((x) => ({ ...x.t, when: 'during' }));
    items.forEach((t) => used.add(t.id));
    trips.push({ key: 'trip-' + start, country, start, end, items });
  }
  for (const t of spent.filter((t) => !used.has(t.id) && isPrep(t.description)).sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : 1))) {
    const window = BOOKED.test(t.description) ? ahead : 2;
    const trip = trips.find((tr) => day(dateOf(t)) <= day(tr.end) + 2 && day(tr.start) - day(dateOf(t)) <= window);
    if (!trip) continue;
    trip.items.push({ ...t, when: day(dateOf(t)) < day(trip.start) ? 'before' : 'during' });
    used.add(t.id);
  }
  for (const tr of trips) tr.items.sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : 1));
  return trips;
}

export function tripName(trip) {
  const y = trip.start.slice(0, 4);
  return trip.country ? 'חופשה ב' + trip.country + ' ' + y : 'טיול לחו״ל ' + y;
}

// Totals: by category, per day and per person; nights = days - 1 (at least 1).
export function tripSummary(trip, people = 2, excluded = new Set(), categoryName = () => '') {
  const items = trip.items.filter((t) => !excluded.has(t.id));
  const by = Object.fromEntries(Object.keys(CATS).map((k) => [k, 0]));
  for (const t of items) by[category(t.description, categoryName(t))] += Number(t.amount) || 0;
  const total = Object.values(by).reduce((s, n) => s + n, 0);
  const days = day(trip.end) - day(trip.start) + 1;
  const nights = Math.max(1, days - 1);
  return { total, by, days, nights, people, perDay: total / days, perPerson: total / Math.max(1, people), perPersonDay: total / days / Math.max(1, people), count: items.length, ahead: items.filter((t) => t.when === 'before' || dateOf(t) < trip.start).reduce((s, t) => s + Number(t.amount), 0) };
}

// A budget for the next trip from a past one: flights per person, lodging
// per night (per room of two), and the rest per person per day; then a
// price-level factor for the destination.
export const LEVELS = { cheaper: { label: 'זול יותר', f: 0.8 }, same: { label: 'דומה', f: 1 }, pricier: { label: 'יקר יותר', f: 1.3 } };
export const PLAN_CATS = ['flights', 'lodging', 'food', 'transport', 'attractions', 'shopping', 'other'];
// adjust (from the advisor): flightsPerPerson and lodgingPerNight (₪ per
// room of two; they replace the past ones, since distance and the kind of
// stay decide them) and pct per category (+35 = 35% more than the past
// trip's rate), which replaces the general price level for that line.
export function planBudget(base, { days, people, level = 'same', adjust = {} }) {
  const f = LEVELS[level]?.f ?? 1;
  const pct = adjust.pct || {};
  const fac = (k) => (Number.isFinite(pct[k]) ? 1 + pct[k] / 100 : f);
  const nights = Math.max(1, days - 1);
  const rooms = (n) => Math.ceil(Math.max(1, n) / 2);
  const pastFare = base.by.flights / Math.max(1, base.people);
  const per = {
    flights: (Number(adjust.flightsPerPerson) > 0 ? Number(adjust.flightsPerPerson) : pastFare * (Number.isFinite(pct.flights) ? fac('flights') : 1)) * people,
    lodging: Number(adjust.lodgingPerNight) > 0
      ? Number(adjust.lodgingPerNight) * nights * rooms(people)
      : (base.by.lodging / base.nights / rooms(base.people)) * nights * rooms(people) * fac('lodging')
  };
  for (const k of ['food', 'transport', 'attractions', 'shopping', 'other']) per[k] = (base.by[k] / base.days / Math.max(1, base.people)) * days * people * fac(k);
  const round = (n) => Math.round(n / 50) * 50;
  const lines = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, round(v)]));
  return { lines, total: Object.values(lines).reduce((s, n) => s + n, 0) };
}

// Months left until the trip (at least 1) and the monthly saving.
export function savingPlan(total, tripDate, today, saved = 0) {
  const t = new Date(tripDate + 'T00:00:00'), n = new Date(today);
  const months = Math.max(1, (t.getFullYear() - n.getFullYear()) * 12 + (t.getMonth() - n.getMonth()));
  const left = Math.max(0, total - saved);
  return { months, monthly: Math.ceil(left / months / 10) * 10, left };
}

// ── the next trip, with the advisor's estimate ──

const ROOMS = (n) => Math.ceil(Math.max(1, n) / 2);

// The past trip's rates, for the advisor and the plan.
export function pastRates(base) {
  const per = (k) => Math.round(base.by[k] / base.days / Math.max(1, base.people));
  return {
    days: base.days, travelers: base.people,
    flight_per_person: Math.round(base.by.flights / Math.max(1, base.people)),
    lodging_per_night: Math.round(base.by.lodging / base.nights / ROOMS(base.people)),
    per_person_per_day: { food: per('food'), transport: per('transport'), attractions: per('attractions'), shopping: per('shopping'), other: per('other') }
  };
}

// The advisor's estimate as plan adjustments: the typical fare and night,
// and its percentages for the rest.
export function adjustFromEstimate(est) {
  if (!est) return { flightsPerPerson: null, lodgingPerNight: null, pct: {} };
  return {
    flightsPerPerson: est.flight_per_person ? est.flight_per_person.typical : null,
    lodgingPerNight: est.lodging_per_night ? est.lodging_per_night.typical : null,
    pct: { ...est.percent_vs_past }
  };
}

// No past trip: the plan straight from the estimate (₪), the daily spend
// split by the usual shares of a trip.
const DAY_SHARE = { food: 0.45, transport: 0.2, attractions: 0.15, shopping: 0.15, other: 0.05 };
export function planFromEstimate(est, { days, people }, rate) {
  const nights = Math.max(1, days - 1);
  const daily = est.daily_per_person_local && rate > 0 ? est.daily_per_person_local * rate : 0;
  const round = (n) => Math.round(n / 50) * 50;
  const lines = {
    flights: round(est.flight_per_person.typical * people),
    lodging: round(est.lodging_per_night.typical * nights * ROOMS(people))
  };
  for (const [k, share] of Object.entries(DAY_SHARE)) lines[k] = round(daily * share * days * people);
  return { lines, total: Object.values(lines).reduce((s, n) => s + n, 0) };
}

// How much the household can put aside each month: half of what is left in
// a regular month (income − fixed − variable), in steps of 50.
export function savingCapacity(baseline) {
  const left = (Number(baseline.income) || 0) - (Number(baseline.fixed) || 0) - (Number(baseline.variable) || 0);
  return left > 0 ? Math.floor(left / 2 / 50) * 50 : 0;
}

// The first month the money is ready at a given monthly saving: 'YYYY-MM'.
export function readyMonth(total, perMonth, today) {
  if (!(perMonth > 0)) return null;
  const months = Math.max(1, Math.ceil(total / perMonth));
  const d = new Date(today.getFullYear(), today.getMonth() + months, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── what the family tells the trip chat ──
// prefs, kept with the plan and changed only through applyChanges:
//   skip      ['lodging', …]       not needed at all (staying with family)
//   covered   { food: 'all' | ₪ }  someone else pays (all of it, or up to ₪)
//   fixed     { flights: ₪ }       the real price, already known (total)
//   pct       { food: -20 }        more or less than the plan
//   funding   ₪                    money that is already there for the trip
//   notes     ['לינה אצל הדודה']   short facts the chat should remember
export const emptyPrefs = () => ({ skip: [], covered: {}, fixed: {}, pct: {}, funding: 0, notes: [] });

const isCat = (k) => PLAN_CATS.includes(k);
const amount = (v, max = 1000000) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null; };

// The chat's changes (already cleaned by the server) onto the prefs. Pure.
export function applyChanges(prefs, ch = {}) {
  // Prefs read back from the database are checked like new changes.
  const p = { ...emptyPrefs(), ...prefs };
  const known = (o, ok) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => isCat(k) && ok(v)));
  const skip = new Set((Array.isArray(p.skip) ? p.skip : []).filter(isCat));
  const covered = known(p.covered, (v) => v === 'all' || amount(v) > 0);
  const fixed = known(p.fixed, (v) => amount(v) != null);
  const pct = known(p.pct, (v) => Number.isFinite(Number(v)));
  if (!Array.isArray(p.notes)) p.notes = [];
  p.notes = p.notes.map((n) => String(n).slice(0, 80));
  if (!(amount(p.funding) >= 0)) p.funding = 0;
  for (const k of ch.clear || []) { if (!isCat(k)) continue; skip.delete(k); delete covered[k]; delete fixed[k]; delete pct[k]; }
  for (const k of ch.skip || []) if (isCat(k)) { skip.add(k); delete covered[k]; delete fixed[k]; }
  for (const k of ch.unskip || []) skip.delete(k);
  for (const [k, v] of Object.entries(ch.covered || {})) {
    if (!isCat(k)) continue;
    if (v === 'all') covered[k] = 'all';
    else if (amount(v) > 0) covered[k] = amount(v);
    else delete covered[k];
    skip.delete(k);
  }
  for (const [k, v] of Object.entries(ch.fixed || {})) { if (isCat(k) && amount(v) != null) { fixed[k] = amount(v); skip.delete(k); } }
  for (const [k, v] of Object.entries(ch.pct || {})) { const n = Number(v); if (isCat(k) && Number.isFinite(n)) pct[k] = Math.max(-100, Math.min(300, Math.round(n))); }
  const funding = ch.funding != null && amount(ch.funding) != null ? amount(ch.funding) : p.funding;
  const notes = [...p.notes.filter((n) => !(ch.notes_remove || []).includes(n)), ...(ch.notes_add || [])].filter((n, i, a) => n && a.indexOf(n) === i).slice(-8);
  return { skip: [...skip], covered, fixed, pct, funding, notes };
}

// The plan after the prefs: every line's cost, what others pay, and what the
// household still has to put aside. total = the trip; toSave = total − covered − funding.
export function personalize(plan, prefs = emptyPrefs()) {
  const p = { ...emptyPrefs(), ...prefs };
  const round = (n) => Math.round(n / 50) * 50;
  const lines = {}, paid = {};
  for (const k of PLAN_CATS) {
    let v = plan.lines[k] || 0;
    if (p.skip.includes(k)) v = 0;
    else if (Number.isFinite(p.fixed[k])) v = p.fixed[k];
    else if (Number.isFinite(p.pct[k])) v = round(v * (1 + p.pct[k] / 100));
    lines[k] = v;
    const c = p.covered[k];
    paid[k] = c === 'all' ? v : Number.isFinite(c) ? Math.min(v, c) : 0;
  }
  const total = Object.values(lines).reduce((s, n) => s + n, 0);
  const covered = Object.values(paid).reduce((s, n) => s + n, 0);
  const funding = Math.min(Math.max(0, total - covered), p.funding || 0);
  return { lines, paid, total, covered, funding, toSave: Math.max(0, total - covered - funding) };
}

// ── a planned trip, saved with its goal (goals.trip_plan) ──
// Everything needed to open the planner again where it was left: where,
// when, how long, how many, the past trip it is based on, the advisor's
// estimate, what the family told the chat, and the conversation itself.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function tripPlanRecord(s) {
  return {
    v: 1,
    dest: String(s.dest || '').slice(0, 60),
    month: MONTH_RE.test(String(s.month || '')) ? s.month : null,
    days: int(s.days, 1, 60, 6),
    people: int(s.people, 1, 20, 2),
    level: LEVELS[s.level] ? s.level : 'same',
    base_id: s.base_id === undefined ? undefined : s.base_id || null,
    est: s.est || null,
    prefs: applyChanges(s.prefs || emptyPrefs(), {}),
    msgs: (s.msgs || []).filter((m) => m && m.text).slice(-20).map((m) => ({ role: m.role === 'ai' ? 'ai' : 'me', text: String(m.text).slice(0, 600) }))
  };
}

// The planner's starting state for a saved goal. Goals saved before the plan
// was kept: the destination from the name, the month from the date, days and
// travelers from the notes ("6 ימים, 2 נוסעים").
export function tripPlanOf(goal) {
  const p = goal && goal.trip_plan && typeof goal.trip_plan === 'object' ? goal.trip_plan : null;
  if (p) return tripPlanRecord(p);
  const notes = String(goal?.notes || '');
  const d = notes.match(/(\d+)\s*ימים/), t = notes.match(/(\d+)\s*נוסעים/);
  return tripPlanRecord({
    dest: String(goal?.name || '').replace(/^חופשה ב/, '').replace(/^חו״ל$/, ''),
    month: String(goal?.target_date || '').slice(0, 7),
    days: d ? +d[1] : 6, people: t ? +t[1] : 2, base_id: undefined
  });
}
