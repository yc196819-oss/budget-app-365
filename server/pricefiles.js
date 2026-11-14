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
// Chains on a site of their own (no login). Each lists its files its own
// way; list(fetchFn, kind) gives [{ name, url, size }] for 'PriceFull' or
// 'Stores', the newest first where the site says so.
// Set aside for now (paused): these sites do not answer our server, most
// likely because they serve addresses in Israel only. Kept here to load
// them again from a server in Israel later.
const OWN = [
  { key: 'victory', name: 'ויקטורי', site: 'laib', id: '7290696200003', paused: true },
  { key: 'machsanei-hashuk', name: 'מחסני השוק', site: 'laib', id: '7290661400001', paused: true },
  { key: 'hazi-hinam', name: 'חצי חינם', site: 'hazi', id: '7290700100008', paused: true },
  { key: 'carrefour', name: 'קרפור', site: 'carrefour', id: '7290055700007', paused: true },
  { key: 'super-pharm', name: 'סופר-פארם', site: 'superpharm', id: '7290172900007', paused: true }
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
      // (Some files write the short forms: ItemNm, ManufacturerItemDescription.)
      itemName: unescape(tag(it, 'ItemName') || tag(it, 'ItemNm') || tag(it, 'ManufactureItemDescription') || tag(it, 'ManufacturerItemDescription')),
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
// The first file inside a ZIP (some branches' files are zipped, not gzipped:
// Rami Levy's online warehouse read as nothing before).
function unzipFirst(buf) {
  if (!(buf.length > 30 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4)) return null;
  const method = buf.readUInt16LE(8);
  const size = buf.readUInt32LE(18);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const data = size > 0 ? buf.subarray(start, start + size) : buf.subarray(start);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  return null;
}
function gunzip(buf) {
  let b = buf;
  try { b = unzipFirst(buf) || zlib.gunzipSync(buf); } catch (_e) { /* not packed */ }
  if ((b[0] === 0xff && b[1] === 0xfe) || (b.length > 3 && b[1] === 0 && b[3] === 0)) return b.toString('utf16le').replace(/^\uFEFF/, '');
  return b.toString('utf8').replace(/^\uFEFF/, '');
}
async function getBuf(fetchFn, url, opts = {}) {
  const r = await fetchFn(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (() => { try { return new URL(url).host; } catch (_e) { return ''; } })());
  return Buffer.from(await r.arrayBuffer());
}

// Shufersal: the list of full price files, the biggest branch on the page.
//   avoid: branch numbers not to take (the chain's online warehouse).
async function shufersal(fetchFn, avoid = null) {
  const html = (await getBuf(fetchFn, SHUF + '/FileObject/UpdateCategory?catID=2&storeId=0&page=1')).toString('utf8');
  const rows = [...html.matchAll(/href="(https:\/\/pricesprodpublic[^"]+PriceFull[^"]+)"[\s\S]*?<\/tr>/g)];
  const sizes = rows.map((r) => ({ url: unescape(r[1]), size: Number((r[0].match(/<td>([\d.]+)\s*KB<\/td>/i) || [])[1]) || 0 }))
    .filter((f) => !(avoid && avoid.has(storeOfFile(fileName(f.url)))));
  if (!sizes.length) throw new Error('no files');
  const best = sizes.sort((a, b) => b.size - a.size)[0];
  return withStore(parsePriceFile(gunzip(await getBuf(fetchFn, best.url)), { key: 'shufersal', name: 'שופרסל' }), fileName(best.url));
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
async function cerberus(fetchFn, chain, avoid = null) {
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
  const list = ((await dir.json().catch(() => ({}))).aaData || []).filter((f) => /^PriceFull/i.test(f.fname || '') && !(avoid && avoid.has(storeOfFile(f.fname))));
  if (!list.length) throw new Error('no files');
  // The biggest branch of the last day and a half: at night only a few
  // branches have today's file yet, and the biggest of those may be a small
  // one (Rami Levy loaded 5,300 products instead of 14,000).
  const at = (f) => Date.parse(String(f.time || '').replace(' ', 'T')) || 0;
  const newest = Math.max(...list.map(at));
  const recent = list.filter((f) => at(f) >= newest - 36 * 3600000);
  const best = (recent.length ? recent : list).sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  const r = await call('/file/d' + (chain.dir || '') + '/' + encodeURIComponent(best.fname));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return withStore(parsePriceFile(gunzip(Buffer.from(await r.arrayBuffer())), chain), best.fname);
}

// The other shared site: the chain's list of full price files, the newest
// (by the date and time in the name), then the file's real address on the
// chain's own site, then the file.
const binaStamp = (n) => (n.match(/-(\d{8})-?(\d{4,6})\./) || []).slice(1).join('');
async function bina(fetchFn, chain, avoid = null) {
  const base = 'https://' + chain.host + '.binaprojects.com';
  const query = new URLSearchParams({ _: chain.id, wReshet: 'הכל', WFileType: '4', WDate: '', WStore: '' });
  const list = JSON.parse((await getBuf(fetchFn, base + '/MainIO_Hok.aspx?' + query)).toString('utf8') || '[]');
  const files = (Array.isArray(list) ? list : []).map((f) => String((f && f.FileNm) || '')).filter((n) => /^PriceFull[\w.-]+$/i.test(n) && !(avoid && avoid.has(storeOfFile(n))));
  if (!files.length) throw new Error('no files');
  const newest = files.sort((a, b) => binaStamp(b).localeCompare(binaStamp(a)));
  // The list does not say how big a branch is: a small one (a few dozen
  // products) is passed over for the next, up to three branches.
  let best = [];
  for (const name of newest.slice(0, 3)) {
    const link = JSON.parse((await getBuf(fetchFn, base + '/Download.aspx?FileNm=' + encodeURIComponent(name))).toString('utf8') || '[]');
    const url = String((Array.isArray(link) && link[0] && link[0].SPath) || '');
    if (url.toLowerCase().indexOf(base.toLowerCase() + '/') !== 0) throw new Error('no file link');
    const rows = withStore(parsePriceFile(gunzip(await getBuf(fetchFn, url)), chain), name);
    if (rows.length > best.length) best = rows;
    if (best.length >= 500) break;
  }
  return best;
}

// ── chains on their own sites ──
const LAIB = 'https://laibcatalog.co.il';
const HAZI = 'https://shop.hazi-hinam.co.il';
const HAZI_FILES = 'https://hazihinamprod01.blob.core.windows.net/regulatories/';
const CARREFOUR = 'https://prices.carrefour.co.il';
const SUPERPHARM = 'https://prices.super-pharm.co.il';
const kb = (v) => { const m = String(v || '').match(/([\d.]+)\s*(KB|MB)?/i); return m ? Number(m[1]) * (/mb/i.test(m[2] || '') ? 1024 : 1) : 0; };
const isKind = (kind) => (n) => new RegExp('^' + (kind === 'Stores' ? 'Stores(Full)?' : kind) + '\\d', 'i').test(n);
// Today in Israel, as YYYY-MM-DD (the sites list files by the local day).
const ilDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
// These sites serve people's browsers: they are asked as one (some refuse
// an unknown client).
const BROWSER = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', accept: 'text/html,application/json,*/*', 'accept-language': 'he-IL,he;q=0.9,en;q=0.8' };
const text = async (fetchFn, url) => (await getBuf(fetchFn, url, { headers: BROWSER })).toString('utf8');

// Victory, Mahsanei HaShuk: one JSON list of every file of the chain.
async function laibList(fetchFn, chain, kind) {
  const all = JSON.parse(await text(fetchFn, LAIB + '/webapi/api/getfiles?edi=' + chain.id) || '[]');
  return (Array.isArray(all) ? all : [])
    .filter((f) => f && String(f.fileType || '').toLowerCase() === kind.toLowerCase() && /^[\w.-]+$/.test(String(f.fileName || '')))
    .map((f) => ({ name: f.fileName, url: LAIB + '/webapi/' + chain.id + '/' + f.fileName, size: kb(f.fileSize), at: String(f.fileDate || '') }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
// Hazi Hinam: an HTML page of links by day (50 a page; full price files
// come after the hourly ones, so a few pages are read).
async function haziList(fetchFn, chain, kind) {
  // The shop's page refuses some servers (403); the files themselves are in
  // the chain's public file store, which can list them by itself.
  try { return await haziPage(fetchFn, chain, kind); } catch (e) {
    const list = await haziStore(fetchFn, chain, kind).catch(() => []);
    if (list.length) return list;
    throw e;
  }
}
// The file store's own list (Azure): names, sizes and times, newest first.
function parseBlobList(xml) {
  return [...String(xml).matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)].map((m) => {
    const b = m[1];
    const tag = (t) => ((b.match(new RegExp('<' + t + '>([^<]*)</' + t + '>')) || [])[1] || '');
    return { name: tag('Name'), size: (Number(tag('Content-Length')) || 0) / 1024, at: Date.parse(tag('Last-Modified')) || 0, next: null };
  }).filter((f) => /^[\w.-]+$/.test(f.name));
}
async function haziStore(fetchFn, chain, kind) {
  const files = [];
  let marker = '';
  for (let i = 0; i < 10; i++) {
    const xml = await text(fetchFn, HAZI_FILES + '?' + new URLSearchParams({ restype: 'container', comp: 'list', prefix: kind, maxresults: '5000', ...(marker ? { marker } : {}) }));
    files.push(...parseBlobList(xml));
    marker = (xml.match(/<NextMarker>([^<]+)<\/NextMarker>/) || [])[1] || '';
    if (!marker) break;
  }
  // The newest day's files only (a day after the newest one at most).
  const newest = Math.max(0, ...files.map((f) => f.at));
  return files.filter((f) => isKind(kind)(f.name) && f.at >= newest - 86400000)
    .sort((a, b) => b.at - a.at)
    .map((f) => ({ name: f.name, url: HAZI_FILES + f.name, size: f.size }));
}
async function haziPage(fetchFn, chain, kind) {
  const out = [];
  for (const day of [ilDay(), ilDay(new Date(Date.now() - 86400000))]) {
    for (let p = 1; p <= 15; p++) {
      const html = await text(fetchFn, HAZI + '/Prices?' + new URLSearchParams({ p: String(p), s: '', f: '', t: kind === 'Stores' ? '3' : '1', d: day }));
      const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => r[1]);
      // Columns: time, branch, file, kind, size (KB), link.
      const links = rows.map((r) => {
        const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim());
        return { url: (r.match(/href="(https:\/\/hazihinamprod01\.blob\.core\.windows\.net\/regulatories\/[\w.-]+)"/) || [])[1], size: kb(cells[4]) };
      }).filter((x) => x.url);
      if (!links.length) break;
      const before = out.length;
      for (const x of links) { const name = x.url.slice(HAZI_FILES.length); if (isKind(kind)(name)) out.push({ name, url: x.url, size: x.size }); }
      // The full files come together: once found, a page without them ends it.
      if (before && out.length === before) break;
      if (kind === 'Stores' && out.length) break;
    }
    if (out.length) break;
  }
  return out;
}
// Carrefour: the day's files are a list inside the page itself.
async function carrefourList(fetchFn, chain, kind) {
  const html = await text(fetchFn, CARREFOUR + '/');
  const m = html.match(/const files\s*=\s*(\[[\s\S]*?\]);/);
  const files = m ? JSON.parse(m[1]) : [];
  return files.filter((f) => f && isKind(kind)(String(f.name || '')) && /^[\w.-]+$/.test(f.name))
    .map((f) => { const day = (f.name.match(/-(\d{8})-/) || [])[1]; return day ? { name: f.name, url: CARREFOUR + '/' + day + '/' + f.name, size: Number(f.size) || 0 } : null; })
    .filter(Boolean);
}
// Super-Pharm: an HTML table, filtered by kind on the server, newest first.
async function superpharmList(fetchFn, chain, kind) {
  const html = await text(fetchFn, SUPERPHARM + '/?' + new URLSearchParams({ 'Category-equals': kind }));
  const list = [...html.matchAll(/href="(\/Download\/([\w.-]+)\?bucketName=[\w-]+)"/g)]
    .filter((m) => isKind(kind)(m[2]))
    .map((m) => ({ name: m[2], url: SUPERPHARM + unescape(m[1]), size: 0 }));
  // Nothing found: say what the page held, so the owner's screen shows why.
  if (!list.length) throw new Error('no files: ' + pageHint(html));
  return list;
}
// What a page that had no files looks like, in a few words: its size, its
// title, and how many links it has (and to where).
function pageHint(html) {
  const t = String(html || '');
  const title = ((t.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim().slice(0, 40);
  const links = [...t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const gz = links.filter((l) => /\.gz|download/i.test(l)).slice(0, 1)[0] || '';
  return [Math.round(t.length / 1024) + 'KB', title && '"' + title + '"', links.length + ' links', gz && 'e.g. ' + gz.slice(0, 50)].filter(Boolean).join(', ');
}
const OWN_LIST = { laib: laibList, hazi: haziList, carrefour: carrefourList, superpharm: superpharmList };
const ownList = (fetchFn, chain, kind) => OWN_LIST[chain.site](fetchFn, chain, kind);

// A chain on its own site: the biggest full price file of the newest ones
// (a branch's size says how many products it has); when the site gives no
// sizes, up to three branches are read and the fullest kept.
async function own(fetchFn, chain) {
  const list = await ownList(fetchFn, chain, 'PriceFull');
  if (!list.length) throw new Error('no files');
  const sized = list.some((f) => f.size > 0);
  const tries = sized ? list.slice(0, 60).sort((a, b) => b.size - a.size).slice(0, 2) : list.slice(0, 3);
  let best = [];
  for (const f of tries) {
    const rows = withStore(parsePriceFile(gunzip(await getBuf(fetchFn, f.url, { headers: BROWSER })), chain), f.name);
    if (rows.length > best.length) best = rows;
    if (best.length >= 500) break;
  }
  return best;
}

// Every chain we can reach, in order: its rows, or why not (one failing
// chain never stops the others).
const ready = (c) => (!c.passEnv || !!process.env[c.passEnv]) && !c.paused;
const CHAINS = [{ key: 'shufersal', name: 'שופרסל' }, ...CERBERUS, ...BINA, ...OWN].filter(ready);
//   avoid: { chain key: Set of branch numbers } not to take as the chain's
//   general branch (its online warehouse, compared as a chain of its own).
async function allChains(fetchFn, { only = null, avoid = {} } = {}) {
  const no = (k) => (avoid && avoid[k] ? new Set(avoid[k]) : null);
  const jobs = [{ key: 'shufersal', name: 'שופרסל', run: () => shufersal(fetchFn, no('shufersal')) }, ...CERBERUS.filter(ready).map((c) => ({ ...c, run: () => cerberus(fetchFn, c, no(c.key)) })), ...BINA.map((c) => ({ ...c, run: () => bina(fetchFn, c, no(c.key)) })), ...OWN.map((c) => ({ ...c, run: () => own(fetchFn, c) }))]
    .filter((j) => !only || only.includes(j.key));
  const out = [];
  for (const j of jobs) {
    try { const rows = await j.run(); out.push({ key: j.key, name: j.name, rows, count: rows.length, storeId: rows.storeId || null }); } catch (e) { out.push({ key: j.key, name: j.name, rows: [], count: 0, error: (String(e.message || e) + (e.cause && e.cause.code ? ' (' + e.cause.code + ')' : '')).slice(0, 90) }); }
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
  const parts = String(name).replace(/^(PriceFull|PromoFull)/i, '').split('-');
  if (parts.length < 3) return null;
  const n = parts.length >= 5 ? parts[2] : parts[1];
  return /^\d{1,6}$/.test(n) ? String(Number(n)) : null;
}
// The file's name in an address ("…/PriceFull7290027600007-001-878-….gz?sv=…").
const fileName = (url) => decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || '');
// The branch whose prices these are, kept on the rows (its deals are read
// from the same branch).
function withStore(rows, name) { rows.storeId = storeOfFile(name); return rows; }
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
  if (chain.site) {
    const f = (await ownList(fetchFn, chain, 'Stores'))[0];
    if (!f) throw new Error('no stores file');
    return parseStores(gunzip(await getBuf(fetchFn, f.url, { headers: BROWSER })));
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

// One branch's newest full file of a kind ('PriceFull' or 'PromoFull'), as text.
async function storeFile(fetchFn, chain, storeId, kind = 'PriceFull') {
  const id = String(Number(storeId));
  const isIt = (n) => new RegExp('^' + kind + '[\\w.-]+$', 'i').test(n);
  if (chain.key === 'shufersal') {
    const html = (await getBuf(fetchFn, SHUF + '/FileObject/UpdateCategory?catID=' + (kind === 'PromoFull' ? 4 : 2) + '&storeId=' + encodeURIComponent(id) + '&page=1')).toString('utf8');
    const link = (html.match(new RegExp('href="(https:\\/\\/pricesprodpublic[^"]+' + kind + '[^"]+)"')) || [])[1];
    if (!link) throw new Error('no file for branch');
    return gunzip(await getBuf(fetchFn, unescape(link)));
  }
  if (chain.site) {
    // Newest first where the site says so; otherwise by the time in the name.
    const f = newestOf((await ownList(fetchFn, chain, kind)).filter((x) => storeOfFile(x.name) === id), (x) => fileStamp(x.name));
    if (!f) throw new Error('no file for branch');
    return gunzip(await getBuf(fetchFn, f.url, { headers: BROWSER }));
  }
  if (chain.host) {
    const base = 'https://' + chain.host + '.binaprojects.com';
    const list = JSON.parse((await getBuf(fetchFn, base + '/MainIO_Hok.aspx?' + new URLSearchParams({ _: chain.id, wReshet: 'הכל', WFileType: kind === 'PromoFull' ? '5' : '4', WDate: '', WStore: '' }))).toString('utf8') || '[]');
    const name = newestOf((Array.isArray(list) ? list : []).map((f) => String((f && f.FileNm) || '')).filter((n) => isIt(n) && storeOfFile(n) === id), fileStamp);
    if (!name) throw new Error('no file for branch');
    return gunzip(await binaFile(fetchFn, base, name));
  }
  const site = await cerberusSession(fetchFn, chain);
  const f = newestOf((await site.list(kind)).map((x) => x.fname).filter((n) => storeOfFile(n) === id), fileStamp);
  if (!f) throw new Error('no file for branch');
  return site.get(f);
}
// One branch's full price file: the newest of that branch.
async function storePrices(fetchFn, chain, storeId) {
  return parsePriceFile(await storeFile(fetchFn, chain, storeId, 'PriceFull'), chain);
}
// One branch's deals (the newest full deals file of that branch), as text.
const storePromos = (fetchFn, chain, storeId) => storeFile(fetchFn, chain, storeId, 'PromoFull');

module.exports = { unzipFirst, gunzip, storePromos, storeFile, fileName, parseBlobList, haziList, superpharmList, pageHint, parsePriceFile, parseStores, storeOfFile, shufersal, cerberus, bina, own, ownList, allChains, chainStores, storePrices, CERBERUS, BINA, OWN, CHAINS };
