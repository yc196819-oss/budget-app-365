// The supermarkets' own price files (the price transparency law): every
// large chain publishes all its prices, free, every day. We take one big
// branch per chain (prices hardly differ between a chain's branches), read
// its full price file, and keep each product by its barcode, so the same
// product is compared at every chain. Free; no outside service.
const zlib = require('zlib');

// Chains on the shared price site (one login name each, no password).
const CERBERUS = [
  { key: 'rami-levy', name: 'רמי לוי', user: 'RamiLevi' },
  { key: 'yochananof', name: 'יוחננוף', user: 'yohananof' },
  { key: 'osher-ad', name: 'אושר עד', user: 'osherad' },
  { key: 'tiv-taam', name: 'טיב טעם', user: 'TivTaam' },
  { key: 'keshet', name: 'קשת טעמים', user: 'Keshet' },
  { key: 'fresh-market', name: 'פרש מרקט', user: 'freshmarket' },
  { key: 'stop-market', name: 'סטופ מרקט', user: 'Stop_Market' },
  { key: 'politzer', name: 'פוליצר', user: 'politzer' },
  { key: 'salach-dabach', name: 'סאלח דבאח', user: 'SalachD' },
  { key: 'dor-alon', name: 'דור אלון', user: 'doralon' },
  // These two have a password (published with the name on the government's
  // list of price sites). It is kept in the server's settings, not here; a
  // chain without its password is simply not loaded.
  { key: 'yellow', name: 'יילו', user: 'Paz_bo', passEnv: 'PRICE_PASS_YELLOW' },
  { key: 'super-yuda', name: 'סופר יודה', user: 'yuda_ho', passEnv: 'PRICE_PASS_SUPER_YUDA', dir: '/Yuda' }
];
// Chains on the other shared price site (binaprojects): one address each,
// and the chain's number.
const BINA = [
  { key: 'shefa-birkat-hashem', name: 'שפע ברכת השם', host: 'shefabirkathashem', id: '7290058134977' },
  { key: 'maayan-2000', name: 'מעיין 2000', host: 'maayan2000', id: '7290058159628' },
  { key: 'mishnat-yosef', name: 'משנת יוסף', host: 'ktshivuk', id: '7290058289400' },
  { key: 'king-store', name: 'קינג סטור', host: 'kingstore', id: '7290058108879' },
  { key: 'zol-vebegadol', name: 'זול ובגדול', host: 'zolvebegadol', id: '7290058173198' },
  { key: 'super-sapir', name: 'סופר ספיר', host: 'supersapir', id: '7290058156016' },
  { key: 'shuk-hair', name: 'שוק העיר', host: 'shuk-hayir', id: '7290058148776' },
  { key: 'bareket', name: 'ברקת', host: 'superbareket', id: '7290875100001' },
  { key: 'city-market', name: 'סיטי מרקט', host: 'citymarketkiryatgat', id: '7290058288526' },
  { key: 'good-pharm', name: 'גוד פארם', host: 'goodpharm', id: '7290058197699' }
];
const CERB = 'https://url.publishedprices.co.il';
const SHUF = 'https://prices.shufersal.co.il';
const UA = { 'user-agent': 'Mozilla/5.0 (budget app price files)' };

const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '>([^<]*)</' + name + '>', 'i')); return m ? m[1].trim() : ''; };
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// A full price file (XML) into rows the catalog keeps. Only real barcodes
// (8 digits or more: a chain's own short codes do not match across chains).
function parsePriceFile(xml, chain) {
  const out = [];
  const re = /<Item>([\s\S]*?)<\/Item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const it = m[1];
    const code = tag(it, 'ItemCode').replace(/\D/g, '');
    const price = Number(tag(it, 'ItemPrice'));
    if (!/^[0-9]{8,14}$/.test(code) || !(price > 0 && price < 100000)) continue;
    const unit = tag(it, 'UnitOfMeasure') || tag(it, 'UnitQty');
    out.push({
      barcode: code,
      itemName: unescape(tag(it, 'ItemName') || tag(it, 'ManufactureItemDescription')),
      manufacturer: unescape(tag(it, 'ManufactureName') || tag(it, 'ManufacturerName')),
      quantity: Number(tag(it, 'Quantity')) || null,
      unitQty: /לא ידוע/.test(unit) ? '' : unit,
      price,
      chainKey: chain.key,
      chainName: chain.name
    });
  }
  return out;
}

// A file as text: unpacked when packed, and read as UTF-16 when the chain
// wrote it so (some branch lists are).
function gunzip(buf) {
  let b = buf;
  try { b = zlib.gunzipSync(buf); } catch (_e) { /* not packed */ }
  if ((b[0] === 0xff && b[1] === 0xfe) || (b.length > 3 && b[1] === 0 && b[3] === 0)) return b.toString('utf16le').replace(/^\uFEFF/, '');
  return b.toString('utf8').replace(/^\uFEFF/, '');
}
async function getBuf(fetchFn, url, opts = {}) {
  const r = await fetchFn(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// Shufersal: the list of full price files, the biggest branch on the page.
async function shufersal(fetchFn) {
  const html = (await getBuf(fetchFn, SHUF + '/FileObject/UpdateCategory?catID=2&storeId=0&page=1')).toString('utf8');
  const rows = [...html.matchAll(/href="(https:\/\/pricesprodpublic[^"]+PriceFull[^"]+)"[\s\S]*?<\/tr>/g)];
  const sizes = rows.map((r) => ({ url: unescape(r[1]), size: Number((r[0].match(/<td>([\d.]+)\s*KB<\/td>/i) || [])[1]) || 0 }));
  if (!sizes.length) throw new Error('no files');
  const best = sizes.sort((a, b) => b.size - a.size)[0];
  return parsePriceFile(gunzip(await getBuf(fetchFn, best.url)), { key: 'shufersal', name: 'שופרסל' });
}

// The shared site: logged in by name; then its files can be listed (by
// kind) and taken.
async function cerberusSession(fetchFn, chain) {
  const jar = new Map();
  const keep = (r) => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const call = async (path, opts = {}) => { const r = await fetchFn(CERB + path, { redirect: 'manual', ...opts, headers: { ...UA, cookie: cookie(), ...(opts.headers || {}) } }); keep(r); return r; };
  const token = (html) => (html.match(/name="csrftoken" content="([^"]+)"/) || [])[1] || '';
  const form = (o) => new URLSearchParams(o).toString();
  const t1 = token(await (await call('/login')).text());
  const login = await call('/login/user', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ r: '', username: chain.user, password: (chain.passEnv && process.env[chain.passEnv]) || '', Submit: 'Sign in', csrftoken: t1 }) });
  if (!/\/file/.test(login.headers.get('location') || '')) throw new Error('login refused');
  const t2 = token(await (await call('/file')).text());
  return {
    list: async (kind) => {
      const dir = await call('/file/json/dir', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ sEcho: '1', iColumns: '5', iDisplayStart: '0', iDisplayLength: '100000', sSearch: kind, cd: chain.dir || '/', csrftoken: t2 }) });
      return ((await dir.json().catch(() => ({}))).aaData || []).filter((f) => new RegExp('^' + kind, 'i').test(f.fname || ''));
    },
    get: async (fname) => {
      const r = await call('/file/d' + (chain.dir || '') + '/' + encodeURIComponent(fname));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return gunzip(Buffer.from(await r.arrayBuffer()));
    }
  };
}

// The shared site: log in by name, list the full price files, take the
// biggest one of the latest day.
async function cerberus(fetchFn, chain) {
  const jar = new Map();
  const keep = (r) => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const call = async (path, opts = {}) => { const r = await fetchFn(CERB + path, { redirect: 'manual', ...opts, headers: { ...UA, cookie: cookie(), ...(opts.headers || {}) } }); keep(r); return r; };
  const token = (html) => (html.match(/name="csrftoken" content="([^"]+)"/) || [])[1] || '';
  const t1 = token(await (await call('/login')).text());
  const form = (o) => new URLSearchParams(o).toString();
  const login = await call('/login/user', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ r: '', username: chain.user, password: (chain.passEnv && process.env[chain.passEnv]) || '', Submit: 'Sign in', csrftoken: t1 }) });
  if (!/\/file/.test(login.headers.get('location') || '')) throw new Error('login refused');
  const t2 = token(await (await call('/file')).text());
  const dir = await call('/file/json/dir', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ sEcho: '1', iColumns: '5', iDisplayStart: '0', iDisplayLength: '100000', sSearch: 'PriceFull', cd: chain.dir || '/', csrftoken: t2 }) });
  const list = ((await dir.json().catch(() => ({}))).aaData || []).filter((f) => /^PriceFull/i.test(f.fname || ''));
  if (!list.length) throw new Error('no files');
  const day = list.map((f) => String(f.time || '').slice(0, 10)).sort().pop();
  const best = list.filter((f) => String(f.time || '').slice(0, 10) === day).sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  const r = await call('/file/d' + (chain.dir || '') + '/' + encodeURIComponent(best.fname));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return parsePriceFile(gunzip(Buffer.from(await r.arrayBuffer())), chain);
}

// The other shared site: the chain's list of full price files, the newest
// (by the date and time in the name), then the file's real address on the
// chain's own site, then the file.
const binaStamp = (n) => (n.match(/-(\d{8})-?(\d{4,6})\./) || []).slice(1).join('');
async function bina(fetchFn, chain) {
  const base = 'https://' + chain.host + '.binaprojects.com';
  const query = new URLSearchParams({ _: chain.id, wReshet: 'הכל', WFileType: '4', WDate: '', WStore: '' });
  const list = JSON.parse((await getBuf(fetchFn, base + '/MainIO_Hok.aspx?' + query)).toString('utf8') || '[]');
  const files = (Array.isArray(list) ? list : []).map((f) => String((f && f.FileNm) || '')).filter((n) => /^PriceFull[\w.-]+$/i.test(n));
  if (!files.length) throw new Error('no files');
  const newest = files.sort((a, b) => binaStamp(b).localeCompare(binaStamp(a)));
  // The list does not say how big a branch is: a small one (a few dozen
  // products) is passed over for the next, up to three branches.
  let best = [];
  for (const name of newest.slice(0, 3)) {
    const link = JSON.parse((await getBuf(fetchFn, base + '/Download.aspx?FileNm=' + encodeURIComponent(name))).toString('utf8') || '[]');
    const url = String((Array.isArray(link) && link[0] && link[0].SPath) || '');
    if (url.toLowerCase().indexOf(base.toLowerCase() + '/') !== 0) throw new Error('no file link');
    const rows = parsePriceFile(gunzip(await getBuf(fetchFn, url)), chain);
    if (rows.length > best.length) best = rows;
    if (best.length >= 500) break;
  }
  return best;
}

// Every chain we can reach, in order: its rows, or why not (one failing
// chain never stops the others).
const ready = (c) => !c.passEnv || !!process.env[c.passEnv];
const CHAINS = [{ key: 'shufersal', name: 'שופרסל' }, ...CERBERUS, ...BINA].filter(ready);
async function allChains(fetchFn, { only = null } = {}) {
  const jobs = [{ key: 'shufersal', name: 'שופרסל', run: () => shufersal(fetchFn) }, ...CERBERUS.filter(ready).map((c) => ({ ...c, run: () => cerberus(fetchFn, c) })), ...BINA.map((c) => ({ ...c, run: () => bina(fetchFn, c) }))]
    .filter((j) => !only || only.includes(j.key));
  const out = [];
  for (const j of jobs) {
    try { const rows = await j.run(); out.push({ key: j.key, name: j.name, rows, count: rows.length }); } catch (e) { out.push({ key: j.key, name: j.name, rows: [], count: 0, error: String(e.message || e).slice(0, 80) }); }
  }
  return out;
}

// ── branches ──
// A chain's list of branches (the transparency law's "Stores" file): number,
// name, address and the settlement's official number (or, at a few chains,
// its name).
function parseStores(xml) {
  const out = [];
  const re = /<Store>([\s\S]*?)<\/Store>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const it = m[1];
    const id = tag(it, 'StoreID') || tag(it, 'StoreId');
    if (!/^\d{1,6}$/.test(id)) continue;
    out.push({ store_id: String(Number(id)), name: unescape(tag(it, 'StoreName')).slice(0, 80), address: unescape(tag(it, 'Address')).slice(0, 120), city: unescape(tag(it, 'City')).slice(0, 60) });
  }
  return out;
}
// The branch number inside a price file's name: PriceFull<chain>-<sub>-<branch>-<date>…
// or PriceFull<chain>-<branch>-<date>….
function storeOfFile(name) {
  const parts = String(name).replace(/^PriceFull/i, '').split('-');
  if (parts.length < 3) return null;
  const n = parts.length >= 5 ? parts[2] : parts[1];
  return /^\d{1,6}$/.test(n) ? String(Number(n)) : null;
}
const newestOf = (files, stamp) => files.slice().sort((a, b) => stamp(b).localeCompare(stamp(a)))[0] || null;
const fileStamp = (n) => (String(n).match(/-(\d{8})-?(\d{4,6})/) || []).slice(1).join('');

// One chain's branches, from its newest branch list.
async function chainStores(fetchFn, chain) {
  if (chain.key === 'shufersal') {
    const html = (await getBuf(fetchFn, SHUF + '/FileObject/UpdateCategory?catID=5&storeId=0&page=1')).toString('utf8');
    const link = (html.match(/href="(https:\/\/pricesprodpublic[^"]+Stores[^"]+)"/) || [])[1];
    if (!link) throw new Error('no stores file');
    return parseStores(gunzip(await getBuf(fetchFn, unescape(link))));
  }
  if (chain.host) {
    const base = 'https://' + chain.host + '.binaprojects.com';
    const list = JSON.parse((await getBuf(fetchFn, base + '/MainIO_Hok.aspx?' + new URLSearchParams({ _: chain.id, wReshet: 'הכל', WFileType: '1', WDate: '', WStore: '' }))).toString('utf8') || '[]');
    const name = newestOf((Array.isArray(list) ? list : []).map((f) => String((f && f.FileNm) || '')).filter((n) => /^Stores[\w.-]+$/i.test(n)), fileStamp);
    if (!name) throw new Error('no stores file');
    return parseStores(gunzip(await binaFile(fetchFn, base, name)));
  }
  const site = await cerberusSession(fetchFn, chain);
  const f = newestOf((await site.list('Stores')).map((x) => x.fname), fileStamp);
  if (!f) throw new Error('no stores file');
  return parseStores(await site.get(f));
}
// A file on the second shared site: its real address (only on the chain's
// own address), then the file.
async function binaFile(fetchFn, base, name) {
  const link = JSON.parse((await getBuf(fetchFn, base + '/Download.aspx?FileNm=' + encodeURIComponent(name))).toString('utf8') || '[]');
  const url = String((Array.isArray(link) && link[0] && link[0].SPath) || '');
  if (url.toLowerCase().indexOf(base.toLowerCase() + '/') !== 0) throw new Error('no file link');
  return getBuf(fetchFn, url);
}

// One branch's full price file: the newest of that branch.
async function storePrices(fetchFn, chain, storeId) {
  const id = String(Number(storeId));
  if (chain.key === 'shufersal') {
    const html = (await getBuf(fetchFn, SHUF + '/FileObject/UpdateCategory?catID=2&storeId=' + encodeURIComponent(id) + '&page=1')).toString('utf8');
    const link = (html.match(/href="(https:\/\/pricesprodpublic[^"]+PriceFull[^"]+)"/) || [])[1];
    if (!link) throw new Error('no file for branch');
    return parsePriceFile(gunzip(await getBuf(fetchFn, unescape(link))), chain);
  }
  if (chain.host) {
    const base = 'https://' + chain.host + '.binaprojects.com';
    const list = JSON.parse((await getBuf(fetchFn, base + '/MainIO_Hok.aspx?' + new URLSearchParams({ _: chain.id, wReshet: 'הכל', WFileType: '4', WDate: '', WStore: '' }))).toString('utf8') || '[]');
    const name = newestOf((Array.isArray(list) ? list : []).map((f) => String((f && f.FileNm) || '')).filter((n) => /^PriceFull[\w.-]+$/i.test(n) && storeOfFile(n) === id), fileStamp);
    if (!name) throw new Error('no file for branch');
    return parsePriceFile(gunzip(await binaFile(fetchFn, base, name)), chain);
  }
  const site = await cerberusSession(fetchFn, chain);
  const f = newestOf((await site.list('PriceFull')).map((x) => x.fname).filter((n) => storeOfFile(n) === id), fileStamp);
  if (!f) throw new Error('no file for branch');
  return parsePriceFile(await site.get(f), chain);
}

module.exports = { parsePriceFile, parseStores, storeOfFile, shufersal, cerberus, bina, allChains, chainStores, storePrices, CERBERUS, BINA, CHAINS };
