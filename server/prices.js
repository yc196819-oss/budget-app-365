// Supermarket price files (the price transparency law): every large chain
// publishes its stores and prices on a public site. Some of those sites
// refuse visitors from outside Israel, so first: which ones answer our
// server at all. Pure apart from the fetch it is given.

const CHAINS = [
  { key: 'shufersal', name: 'שופרסל', url: 'https://prices.shufersal.co.il/' },
  { key: 'cerberus', name: 'רמי לוי, יוחננוף, אושר עד, טיב טעם ועוד (אתר משותף)', url: 'https://url.publishedprices.co.il/login' },
  { key: 'carrefour', name: 'קרפור', url: 'https://prices.carrefour.co.il/' },
  { key: 'laib', name: 'ויקטורי, מחסני השוק ועוד', url: 'https://laibcatalog.co.il/' },
  { key: 'hazi', name: 'חצי חינם', url: 'https://shop.hazi-hinam.co.il/Prices' },
  { key: 'bitan', name: 'יינות ביתן', url: 'https://prices.ybitan.co.il/' },
  { key: 'mega', name: 'מגה', url: 'https://publishprice.mega.co.il/' },
  { key: 'king', name: 'קינג סטור', url: 'https://www.kingstore.co.il/Food_Law/Main.aspx' },
  { key: 'superpharm', name: 'סופר-פארם', url: 'https://prices.super-pharm.co.il/' }
];

// One site: does it answer, how fast, and with what. A 403 or a timeout
// usually means the site blocks visitors from abroad.
async function probeOne(chain, fetchFn, timeoutMs = 12000) {
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchFn(chain.url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (budget app price check)' } });
    return { key: chain.key, name: chain.name, status: r.status, ok: r.status >= 200 && r.status < 400, ms: Date.now() - started };
  } catch (e) {
    return { key: chain.key, name: chain.name, status: 0, ok: false, ms: Date.now() - started, error: ctl.signal.aborted ? 'timeout' : String((e && e.cause && e.cause.code) || (e && e.message) || 'error').slice(0, 60) };
  } finally {
    clearTimeout(t);
  }
}

async function probeAll(fetchFn, chains = CHAINS, timeoutMs) {
  return Promise.all(chains.map((c) => probeOne(c, fetchFn, timeoutMs)));
}

module.exports = { CHAINS, probeOne, probeAll };

// ═══ the outside price service (Apify), first a check ═══
// A service that reads the same official price files from inside Israel.
// Before building on it: what it asks for, what one small run returns, and
// what it costs. The key stays on the server (APIFY_TOKEN); nothing is kept.
const APIFY = 'https://api.apify.com/v2';
const ACTOR = process.env.APIFY_ACTOR || 'swerve~supermarket-prices';

async function apifyGet(fetchFn, token, path) {
  const r = await fetchFn(APIFY + path, { headers: { Authorization: 'Bearer ' + token } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Apify ' + r.status + ': ' + String((body.error && body.error.message) || '').slice(0, 160));
  return body.data;
}

// What the service is, what it costs, and the fields it takes.
async function apifyAbout(fetchFn, token, actor = ACTOR) {
  const a = await apifyGet(fetchFn, token, '/acts/' + actor);
  let fields = [];
  const buildId = a && a.taggedBuilds && a.taggedBuilds.latest && a.taggedBuilds.latest.buildId;
  if (buildId) {
    const b = await apifyGet(fetchFn, token, '/actor-builds/' + buildId).catch(() => null);
    let schema = b && b.inputSchema;
    if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch (_e) { schema = null; } }
    const props = (schema && schema.properties) || {};
    fields = Object.entries(props).slice(0, 30).map(([key, p]) => ({
      key, title: String(p.title || '').slice(0, 80), type: p.type || p.editor || '',
      example: p.prefill !== undefined ? p.prefill : p.default !== undefined ? p.default : (p.enum ? p.enum.slice(0, 8) : undefined)
    }));
  }
  let example = null;
  const ex = a && a.exampleRunInput && a.exampleRunInput.body;
  if (ex) { try { example = JSON.parse(ex); } catch (_e) { example = null; } }
  const pricing = ((a && a.pricingInfos) || []).slice(-1)[0] || null;
  return {
    title: String((a && a.title) || actor).slice(0, 100),
    description: String((a && a.description) || '').slice(0, 400),
    modified: (a && a.modifiedAt) || null,
    pricing: pricing ? { model: pricing.pricingModel || '', perUnit: pricing.pricePerUnitUsd ?? null, unit: pricing.unitName || '', events: pricing.pricingPerEvent || null } : null,
    fields, example
  };
}

// One small run (at most `limit` results), with the input given or the
// service's own example. Returns the field names and a few rows as they came.
async function apifySample(fetchFn, token, input, { actor = ACTOR, limit = 15, seconds = 120 } = {}) {
  const started = Date.now();
  const url = APIFY + '/acts/' + actor + '/run-sync-get-dataset-items?timeout=' + seconds + '&maxItems=' + limit + '&clean=true';
  const r = await fetchFn(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) });
  const text = await r.text();
  let items = [];
  try { items = JSON.parse(text); } catch (_e) { items = []; }
  if (!r.ok) {
    let msg = '';
    try { msg = JSON.parse(text).error.message; } catch (_e) { msg = text; }
    throw new Error('Apify ' + r.status + ': ' + String(msg).slice(0, 200));
  }
  if (!Array.isArray(items)) items = [];
  const keys = [...new Set(items.flatMap((x) => (x && typeof x === 'object' ? Object.keys(x) : [])))].slice(0, 40);
  const short = (v) => (v && typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v ?? '').slice(0, 120));
  return { seconds: Math.round((Date.now() - started) / 1000), count: items.length, keys, rows: items.slice(0, limit).map((x) => Object.fromEntries(Object.entries(x || {}).slice(0, 14).map(([k, v]) => [k, short(v)]))) };
}

module.exports.apifyAbout = apifyAbout;
module.exports.apifySample = apifySample;
module.exports.APIFY_ACTOR = ACTOR;

// A small test search: one product, one store per chain, few rows, no
// photos. Built from the fields the service itself lists.
const SAMPLE_INPUT = { mode: 'compareProducts', productQueries: ['חלב 3%'], oneStorePerChain: true, includeImages: false, maxItems: 15, maxRowsPerChain: 5 };

// The run is started and then checked on, instead of waiting on one long
// request (the server gives up on those before the service is done).
async function apifyStart(fetchFn, token, input, { actor = ACTOR, seconds = 300 } = {}) {
  const r = await fetchFn(APIFY + '/acts/' + actor + '/runs?timeout=' + seconds, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Apify ' + r.status + ': ' + String((body.error && body.error.message) || '').slice(0, 200));
  return { runId: body.data && body.data.id, status: body.data && body.data.status };
}
const DONE = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];
async function apifyCheck(fetchFn, token, runId, { limit = 15 } = {}) {
  if (!/^[A-Za-z0-9]{6,40}$/.test(String(runId || ''))) throw new Error('bad run');
  const run = await apifyGet(fetchFn, token, '/actor-runs/' + runId);
  const status = (run && run.status) || 'UNKNOWN';
  const seconds = run && run.startedAt ? Math.round(((run.finishedAt ? new Date(run.finishedAt) : new Date()) - new Date(run.startedAt)) / 1000) : 0;
  const cost = run && run.usageTotalUsd != null ? Number(run.usageTotalUsd) : null;
  if (!DONE.includes(status)) return { status, done: false, seconds, cost };
  let items = [];
  if (status === 'SUCCEEDED' && run.defaultDatasetId) {
    const r = await fetchFn(APIFY + '/datasets/' + run.defaultDatasetId + '/items?clean=true&limit=' + limit, { headers: { Authorization: 'Bearer ' + token } });
    items = await r.json().catch(() => []);
    if (!Array.isArray(items)) items = [];
  }
  return { status, done: true, seconds, cost, ...shape(items, limit) };
}
function shape(items, limit) {
  const keys = [...new Set(items.flatMap((x) => (x && typeof x === 'object' ? Object.keys(x) : [])))].slice(0, 40);
  const short = (v) => (v && typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v ?? '').slice(0, 120));
  return { count: items.length, keys, rows: items.slice(0, limit).map((x) => Object.fromEntries(Object.entries(x || {}).slice(0, 14).map(([k, v]) => [k, short(v)]))) };
}

module.exports.SAMPLE_INPUT = SAMPLE_INPUT;
module.exports.apifyStart = apifyStart;
module.exports.apifyCheck = apifyCheck;

// ═══ our own catalog: what the price service returns, kept by barcode ═══
// One run brings rows of (barcode, name, maker, size, price, chain, store).
// They become one product per barcode (every name it was seen under, for
// search) and one price per chain (the lowest seen in that run).
const BAD = /^-*$|^---$|^לא ידוע$/;
function catalogRows(items, now = new Date()) {
  const byCode = new Map();
  for (const x of items || []) {
    if (!x || typeof x !== 'object') continue;
    const code = String(x.barcode ?? x.itemCode ?? '').replace(/\D/g, '');
    const price = Number(x.price ?? x.itemPrice);
    const chain = String(x.chainKey || x.chainId || x.chainName || '').trim().slice(0, 40);
    if (!/^[0-9]{4,20}$/.test(code) || !(price > 0 && price < 100000) || !chain) continue;
    const name = String(x.itemName || x.manufacturerItemDescription || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name) continue;
    const p = byCode.get(code) || { names: new Map(), maker: '', qty: null, unit: '', offers: new Map() };
    p.names.set(name, (p.names.get(name) || 0) + 1);
    const maker = String(x.manufacturer || x.manufacturerName || '').trim();
    if (!p.maker && maker && !BAD.test(maker)) p.maker = maker.slice(0, 80);
    const qty = Number(x.quantity);
    const unit = String(x.unitQty || x.unitOfMeasure || '').trim();
    if (p.qty === null && qty > 0 && unit && !BAD.test(unit)) { p.qty = qty; p.unit = unit.slice(0, 20); }
    const o = p.offers.get(chain);
    if (!o || price < o.price) p.offers.set(chain, { price, chain_name: String(x.chainName || chain).slice(0, 60) });
    byCode.set(code, p);
  }
  const at = now.toISOString();
  const products = [];
  const offers = [];
  for (const [barcode, p] of byCode) {
    const names = [...p.names.keys()].sort((a, b) => b.length - a.length);
    products.push({ barcode, name: names[0], names: names.join(' | ').slice(0, 1000), maker: p.maker || null, qty: p.qty, unit: p.unit || null, seen_at: at });
    for (const [chain, o] of p.offers) offers.push({ barcode, chain, chain_name: o.chain_name, price: Math.round(o.price * 100) / 100, seen_at: at });
  }
  return { products, offers };
}

// What to ask the service for: up to `max` typed items, cleaned, each asked
// at most once a week (asked before: answered from our catalog).
function fetchInput(queries, { max = 15 } = {}) {
  const seen = new Set();
  const list = [];
  for (const q of queries || []) {
    const t = String(q || '').replace(/[<>{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    list.push(t);
    if (list.length >= max) break;
  }
  if (!list.length) return null;
  return { mode: 'compareProducts', productQueries: list, oneStorePerChain: true, includeImages: false, maxRowsPerChain: 8, maxItems: Math.min(2000, list.length * 120) };
}

// The catalog is loaded in two steps, so the same product is compared at
// every chain: first the leading products for each name (at two big
// chains), then those exact barcodes at the main chains. The service caps
// rows per chain for a whole run (not per product), so each cap is sized to
// the run. It charges per row: about $1.5 for 20 names.
const MAIN_CHAINS = String(process.env.PRICE_CHAINS || 'shufersal,rami-levy,carrefour,yochananof,osher-ad,victory,hazi-hinam,tiv-taam,machsanei-hashuk,king-store').split(',').map((x) => x.trim()).filter(Boolean);
const PER_NAME = 3;
// One name a run: the service's cap on rows per chain covers the whole
// run, so a broad first name would otherwise use it all up.
function findInput(query) {
  const base = fetchInput([query], { max: 1 });
  if (!base) return null;
  return { mode: 'compareProducts', productQueries: base.productQueries, chains: ['shufersal', 'rami-levy'], oneStorePerChain: true, includeImages: false, maxRowsPerChain: PER_NAME, maxItems: PER_NAME * 2 };
}
// The leading barcodes from the first step: found at both chains first,
// then the rest, at most PER_NAME for each name asked.
function leadBarcodes(items, names) {
  const seen = new Map();
  for (const x of items || []) {
    const code = String((x && (x.barcode ?? x.itemCode)) || '').replace(/\D/g, '');
    if (!/^[0-9]{4,20}$/.test(code)) continue;
    const chain = String(x.chainKey || x.chainId || x.chainName || '');
    const c = seen.get(code) || new Set();
    c.add(chain);
    seen.set(code, c);
  }
  return [...seen.entries()].sort((a, b) => b[1].size - a[1].size).map(([code]) => code).slice(0, Math.max(1, names) * PER_NAME);
}
function compareInput(barcodes) {
  const list = [...new Set((barcodes || []).filter((c) => /^[0-9]{4,20}$/.test(c)))].slice(0, 100);
  if (!list.length) return null;
  return { mode: 'compareProducts', barcodes: list, chains: MAIN_CHAINS, oneStorePerChain: true, includeImages: false, maxRowsPerChain: list.length, maxItems: list.length * MAIN_CHAINS.length };
}
const ROW_USD = 0.002;
// What a load of these names will cost, at most (both steps).
function loadCost(names) { return Math.round(names * PER_NAME * (2 + MAIN_CHAINS.length) * ROW_USD * 100) / 100; }

// A first catalog for the owner to load once: what most families buy.
const SEED = ['חלב 3%', 'חלב 1%', 'ביצים', 'לחם אחיד', 'לחם פרוס', 'חלה', 'פיתות', 'קוטג', 'גבינה לבנה', 'גבינה צהובה', 'יוגורט', 'שמנת חמוצה', 'שמנת מתוקה', 'חמאה', 'לבן', 'מעדן', 'שוקו',
  'אורז', 'פסטה', 'ספגטי', 'קמח', 'סוכר', 'מלח', 'שמן קנולה', 'שמן זית', 'טחינה', 'חומוס', 'עדשים', 'קוסקוס', 'פתיתים', 'קורנפלקס', 'שיבולת שועל', 'קפה', 'תה', 'דבש', 'ריבה', 'ממרח שוקולד',
  'רסק עגבניות', 'טונה', 'תירס', 'זיתים', 'מלפפון חמוץ', 'קטשופ', 'מיונז', 'במבה', 'ביסלי', 'עוגיות', 'חטיף', 'אבקת מרק', 'פפריקה',
  'חזה עוף', 'שניצל', 'כרעיים', 'בשר טחון', 'נקניקיות', 'סלמון', 'שניצל תירס',
  'מים מינרליים', 'סודה', 'מיץ תפוזים', 'קולה', 'פטל',
  'נוזל כלים', 'אבקת כביסה', 'מרכך כביסה', 'אקונומיקה', 'נייר טואלט', 'מגבות נייר', 'שקיות אשפה', 'נייר אלומיניום', 'ספוג',
  'שמפו', 'סבון', 'משחת שיניים', 'דאודורנט', 'חיתולים', 'מגבונים', 'מטרנה', 'במבה נוגט', 'גלידה', 'ירקות קפואים', 'פיצה קפואה', 'בורקס'];

// The owner's word on a product's kashrut is kept as one vote under this id.
const OWNER_VOTE = '00000000-0000-0000-0000-000000000000';

module.exports.catalogRows = catalogRows;
module.exports.fetchInput = fetchInput;
module.exports.SEED = SEED;
module.exports.findInput = findInput;
module.exports.leadBarcodes = leadBarcodes;
module.exports.compareInput = compareInput;
module.exports.loadCost = loadCost;
module.exports.MAIN_CHAINS = MAIN_CHAINS;
module.exports.OWNER_VOTE = OWNER_VOTE;
module.exports.apifyItems = apifyItems;

// Every row of a finished run (not just a sample), for the catalog.
async function apifyItems(fetchFn, token, runId, { limit = 5000 } = {}) {
  if (!/^[A-Za-z0-9]{6,40}$/.test(String(runId || ''))) throw new Error('bad run');
  const run = await apifyGet(fetchFn, token, '/actor-runs/' + runId);
  const status = (run && run.status) || 'UNKNOWN';
  const cost = run && run.usageTotalUsd != null ? Number(run.usageTotalUsd) : null;
  if (!DONE.includes(status)) return { status, done: false, cost, items: [] };
  let items = [];
  if (status === 'SUCCEEDED' && run.defaultDatasetId) {
    const r = await fetchFn(APIFY + '/datasets/' + run.defaultDatasetId + '/items?clean=true&limit=' + limit, { headers: { Authorization: 'Bearer ' + token } });
    items = await r.json().catch(() => []);
    if (!Array.isArray(items)) items = [];
  }
  return { status, done: true, cost, items };
}

// After a night's load: the chains worth one more try a few minutes later,
// those whose site did not answer (a timeout, a name that did not resolve, a
// dropped connection). A site that refused us (403) or had no files would
// only fail again, so it waits for the next night.
function retryLater(done) {
  // (An online shop is read with its chain, not on its own.)
  return (done || []).filter((c) => c && c.error && !c.online && !/HTTP 40[13]|no files|^save:/i.test(String(c.error))).map((c) => c.key);
}
module.exports.retryLater = retryLater;
