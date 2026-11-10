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
  { key: 'dor-alon', name: 'דור אלון', user: 'doralon' }
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

const gunzip = (buf) => { try { return zlib.gunzipSync(buf).toString('utf8'); } catch (_e) { return buf.toString('utf8'); } };
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
  const login = await call('/login/user', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ r: '', username: chain.user, password: '', Submit: 'Sign in', csrftoken: t1 }) });
  if (!/\/file/.test(login.headers.get('location') || '')) throw new Error('login refused');
  const t2 = token(await (await call('/file')).text());
  const dir = await call('/file/json/dir', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ sEcho: '1', iColumns: '5', iDisplayStart: '0', iDisplayLength: '100000', sSearch: 'PriceFull', cd: '/', csrftoken: t2 }) });
  const list = ((await dir.json().catch(() => ({}))).aaData || []).filter((f) => /^PriceFull/i.test(f.fname || ''));
  if (!list.length) throw new Error('no files');
  const day = list.map((f) => String(f.time || '').slice(0, 10)).sort().pop();
  const best = list.filter((f) => String(f.time || '').slice(0, 10) === day).sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  const r = await call('/file/d/' + encodeURIComponent(best.fname));
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
const CHAINS = [{ key: 'shufersal', name: 'שופרסל' }, ...CERBERUS, ...BINA];
async function allChains(fetchFn, { only = null } = {}) {
  const jobs = [{ key: 'shufersal', name: 'שופרסל', run: () => shufersal(fetchFn) }, ...CERBERUS.map((c) => ({ ...c, run: () => cerberus(fetchFn, c) })), ...BINA.map((c) => ({ ...c, run: () => bina(fetchFn, c) }))]
    .filter((j) => !only || only.includes(j.key));
  const out = [];
  for (const j of jobs) {
    try { const rows = await j.run(); out.push({ key: j.key, name: j.name, rows, count: rows.length }); } catch (e) { out.push({ key: j.key, name: j.name, rows: [], count: 0, error: String(e.message || e).slice(0, 80) }); }
  }
  return out;
}

module.exports = { parsePriceFile, shufersal, cerberus, bina, allChains, CERBERUS, BINA, CHAINS };
