// A recipe shared to the app (a link, its text, or a photo) read into what
// to buy. The page is fetched only from a public address (no local or
// private network), small and quickly; its structured recipe (schema.org
// Recipe, which most recipe sites publish) is used when there is one,
// otherwise its text, from the ingredients heading on. When the page cannot
// be fetched here, or no ingredients come out of it, Claude reads the link
// itself (its web fetch tool, limited to that one site). Pure helpers, the
// guarded fetch, and the reading flow with its calls passed in.
const dns = require('dns').promises;
const net = require('net');

// Private, local and reserved addresses: never fetched.
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

// A link someone may give: http(s), a real host name, the default ports.
function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (_e) { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  if (!/\./.test(u.hostname) || net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) return null;
  return u;
}

// Sent like a browser: some sites turn away anything that does not look like one.
const PAGE_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.5',
  'accept-language': 'he-IL,he;q=0.9,en;q=0.6'
};

// The page, if it is public: every address the name resolves to is checked,
// and redirects are followed by hand (each one checked again).
async function fetchPage(raw, fetchFn = fetch, lookup = (h) => dns.lookup(h, { all: true })) {
  let u = checkUrl(raw);
  for (let hops = 0; u && hops < 4; hops++) {
    const addrs = await lookup(u.hostname).catch(() => []);
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('blocked');
    const r = await fetchFn(u.href, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: PAGE_HEADERS });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = checkUrl(new URL(r.headers.get('location'), u).href); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.subarray(0, 2 * 1024 * 1024).toString('utf8');
  }
  throw new Error('bad link');
}

const ENTITIES = { nbsp: ' ', quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", frac12: '½', frac14: '¼', frac34: '¾', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]\w*);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
    return ENTITIES[e.toLowerCase()] || m;
  });
}

// Every object in a JSON-LD block, however deep (graphs, lists, nesting).
function* objects(j, depth = 0) {
  if (!j || typeof j !== 'object' || depth > 6) return;
  if (Array.isArray(j)) { for (const x of j) yield* objects(x, depth + 1); return; }
  yield j;
  for (const v of Object.values(j)) if (v && typeof v === 'object') yield* objects(v, depth + 1);
}
const isRecipe = (x) => x['@type'] === 'Recipe' || (Array.isArray(x['@type']) && x['@type'].includes('Recipe'));

// Where the ingredients begin in a page's text, in Hebrew or English.
const INGREDIENTS = /(^|\n)[^\n]{0,30}(מצרכים|רכיבים|המרכיבים|מרכיבים|חומרים|ingredients)[^\n]{0,30}(\n|$)/i;
const TEXT_MAX = 9000;

// What of a page is the recipe: its structured recipe if it has one (the
// ingredients and how many it serves), otherwise its text without the menus,
// header, footer and sidebars, starting a little before its ingredients
// heading. `found` says whether ingredients were seen at all.
function recipeText(html) {
  const s = String(html || '');
  for (const m of s.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j;
    try { j = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, '').replace(/^\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>$/g, '')); } catch (_e) { continue; }
    for (const r of objects(j)) {
      if (!isRecipe(r)) continue;
      const list = [].concat(r.recipeIngredient || r.ingredients || []).map((x) => decode(String(x)).trim()).filter(Boolean);
      if (!list.length) continue;
      const yieldText = [].concat(r.recipeYield || []).join(' ');
      return { title: decode(String(r.name || '')).slice(0, 80), text: 'מנות: ' + yieldText + '\nמצרכים:\n' + list.join('\n'), structured: true, found: true };
    }
  }
  // Microdata (itemprop="recipeIngredient"), which some older sites use.
  const micro = [...s.matchAll(/<[^>]+itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/(?:li|span|p|div)>/gi)]
    .map((m) => decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const title = decode(((s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim()).slice(0, 80);
  if (micro.length >= 2) return { title, text: 'מצרכים:\n' + micro.join('\n'), structured: true, found: true };

  // The page's own text: what is not the recipe goes first, the blocks keep their lines.
  let body = s.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const article = body.match(/<article\b[\s\S]*<\/article>/i) || body.match(/<main\b[\s\S]*<\/main>/i);
  if (article) body = article[0];
  const text = decode(body.replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|tr|ul|ol)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n[\s\n]*/g, '\n').trim();
  const at = text.search(INGREDIENTS);
  // A few lines before the heading (the dish's name, how many it serves), from a line's start.
  const back = Math.max(0, at - 600);
  const nl = at > 0 ? text.indexOf('\n', back) : -1;
  const from = at <= 0 || back === 0 ? 0 : nl >= 0 && nl < at ? nl + 1 : back;
  return { title, text: text.slice(from, from + TEXT_MAX), structured: false, found: at >= 0 };
}

const RECIPE_PROMPT = `קיבלת מתכון (טקסט מאתר, טקסט שהודבק או תמונה). הוצא ממנו רק את המצרכים שצריך לקנות.
החזר JSON בלבד: {"title":"שם המנה","servings":4,"items":[{"name":"ביצים","qty":6,"unit":"יח'","aisle":"dairy","pantry":false}]}
- servings: לכמה מנות המתכון (אם לא כתוב, 4).
- name: שם המוצר כמו שכותבים ברשימת קניות, בלי הוראות הכנה ("בצל", לא "בצל קצוץ דק").
- qty מספר ו-unit: כמה קונים בחנות, לא כמה שמים בסיר. unit רק אחד מ: גרם, ק"ג, מ"ל, ליטר, יחידות, חבילות, קופסאות, צרור.
  אסור כוסות, כפות, כפיות, קורט או "מעט": המר לגרמים (מוצקים) או למ"ל (נוזלים). למשל "¼ כוס פירורי לחם" -> 30 גרם, "2 כוסות קמח" -> 260 גרם, "3 כפות שמן זית" -> 45 מ"ל.
  מה שקונים רק באריזה (רסק, שמנת, אבקת אפייה, תבלין, שמרים) -> qty 1 ו-unit "חבילות" או "קופסאות". ירקות ופירות שקונים ביחידות (בצל, לימון, שום) -> יחידות או ראש/צרור.
- אל תכלול מים מהברז.
- pantry:true למה שרוב הבתים כבר מחזיקים: מלח, פלפל שחור, סוכר, שמן, קמח, אורז, תבלינים, אבקת אפייה, סודה לשתייה, חומץ.
- aisle אחד מ: produce, bakery, dairy, meat, dry, frozen, drinks, clean, care, baby, other.
- אם זה לא מתכון, החזר {"title":"","servings":0,"items":[]}.`;

// Said to Claude when it reads the link itself.
const LINK_NOTE = (href) => `\n\nהמתכון נמצא בקישור הזה. קרא את הדף בכלי web_fetch (רק את הקישור הזה), מצא את רשימת המצרכים, והחזר את ה-JSON לפי ההוראות למעלה. אם בדף יש כמה מתכונים, קח את המתכון הראשי.\n${href}`;

// The JSON in Claude's answer, or null.
function parseAnswer(out) {
  const s = String(out || '');
  const from = s.indexOf('{');
  const to = s.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try { const j = JSON.parse(s.slice(from, to + 1)); return j && typeof j === 'object' ? j : null; } catch (_e) { return null; }
}
// Claude's final words: the text after its last tool result (what it said
// before reading the page is not the answer).
function answerText(content) {
  const list = Array.isArray(content) ? content : [];
  const lastTool = list.map((c) => /_tool_result$/.test(String(c && c.type))).lastIndexOf(true);
  return list.slice(lastTool + 1).filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
}
const hasItems = (p) => !!(p && Array.isArray(p.items) && p.items.length);

// Amounts in what people buy, not what goes in the pot: a cup, spoon or pinch
// that still comes back is turned into grams (millilitres for liquids), and a
// small amount of something sold in packs is one pack. The weights are rough,
// which is enough for a shopping list.
const CUP = /^(כוס|כוסות)$/;
const TBSP = /^(כף|כפות)$/;
const TSP = /^(כפית|כפיות)$/;
const PINCH = /^(קורט|קמצוץ|מעט|לפי הטעם|ק"ט)$/;
const LIQUID = /(^|\s)(מים|שמן|חלב|מיץ|יין|ציר|רוטב סויה|סויה|חומץ|סילאן|דבש|שמנת מתוקה|שמנת לבישול|רוטב)(\s|$)/;
const TAP_WATER = /^(מים|מים רותחים|מים חמים|מים קרים|מים פושרים)$/;
const GRAMS_PER_CUP = [[/קמח/, 130], [/סוכר/, 200], [/אורז|עדשים|גריסים|קינואה|בורגול|קוסקוס|פתיתים/, 190], [/פירורי לחם|פנקו/, 120], [/שיבולת|קוואקר/, 90], [/אגוז|שקדים|בוטנים/, 120], [/גבינ|ריקוטה|קוטג/, 230], [/שוקולד צ'יפס|צימוקים/, 160], [/קקאו/, 90]];
const SMALL = 30; // below this many grams or millilitres, buy one pack
function buyAmount(item) {
  const it = { ...item };
  const name = String(it.name || '').trim();
  const unit = String(it.unit || '').trim();
  const qty = Number(it.qty);
  if (TAP_WATER.test(name)) return null;
  const pack = () => ({ ...it, qty: 1, unit: 'חבילות', scale: false });
  if (PINCH.test(unit)) return pack();
  if (/^(גרם|גר'?|מ"ל|מל)$/.test(unit) && Number.isFinite(qty) && qty > 0 && qty < SMALL) return pack();
  const perCup = CUP.test(unit) ? 1 : TBSP.test(unit) ? 1 / 16 : TSP.test(unit) ? 1 / 48 : 0;
  if (!perCup) return it;
  if (!Number.isFinite(qty) || qty <= 0) return pack();
  const liquid = LIQUID.test(name);
  const cupSize = liquid ? 240 : ((GRAMS_PER_CUP.find(([re]) => re.test(name)) || [])[1] || 150);
  const amount = qty * perCup * cupSize;
  if (amount < SMALL) return pack();
  const round = amount >= 200 ? 50 : 10;
  return { ...it, qty: Math.round(amount / round) * round, unit: liquid ? 'מ"ל' : 'גרם' };
}
function buyAmounts(items) {
  return (Array.isArray(items) ? items : []).map((x) => (x && typeof x === 'object' ? buyAmount(x) : null)).filter(Boolean);
}

// A recipe read from a link, text or a picture. `ask({ prompt, image,
// readUrl })` calls Claude and returns its text; with readUrl Claude may read
// that page itself. Returns { recipe } or { error, status }.
async function readRecipe({ url, text, image }, { ask, fetch: getPage = fetchPage }) {
  let src = { title: '', text: String(text || '').slice(0, TEXT_MAX), found: false };
  let link = null;
  let pageFailed = false;
  if (url) {
    link = checkUrl(url);
    if (!link) return { status: 400, error: 'הקישור לא תקין. אפשר להדביק את המתכון כטקסט.' };
    try { src = recipeText(await getPage(link.href)); } catch (_e) { pageFailed = true; }
  }
  if (!link && !src.text && !image) return { status: 400, error: 'צריך קישור, טקסט או תמונה של מתכון.' };

  let parsed = null;
  let via = 'page';
  if (!pageFailed && (src.text || image)) {
    parsed = parseAnswer(await ask({ prompt: RECIPE_PROMPT + (src.title ? '\nשם הדף: ' + src.title : '') + '\n\n' + src.text, image }));
  }
  // The page did not open here, or nothing came out of it: Claude reads the link.
  if (link && !hasItems(parsed)) {
    via = 'claude';
    parsed = parseAnswer(await ask({ prompt: RECIPE_PROMPT + LINK_NOTE(link.href), readUrl: link }).catch(() => ''));
  }
  if (parsed && Array.isArray(parsed.items)) parsed.items = buyAmounts(parsed.items);
  if (!hasItems(parsed)) {
    return link && pageFailed && parsed === null
      ? { status: 502, error: 'לא הצלחנו לפתוח את הקישור. אפשר להדביק את המתכון כטקסט.' }
      : { status: 422, error: 'לא מצאנו כאן מתכון עם מצרכים. אפשר להדביק את רשימת המצרכים כטקסט.' };
  }
  return { via, recipe: { title: String(parsed.title || src.title || 'מתכון').slice(0, 60), servings: Number(parsed.servings) || 4, items: parsed.items.slice(0, 40) } };
}

module.exports = { privateIp, checkUrl, fetchPage, recipeText, readRecipe, parseAnswer, answerText, buyAmounts, RECIPE_PROMPT };
