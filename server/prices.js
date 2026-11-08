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
