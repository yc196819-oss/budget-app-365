// A recipe shared to the app (a link, its text, or a photo) read into what
// to buy. The page is fetched only from a public address (no local or
// private network), small and quickly; its structured recipe (schema.org
// Recipe, which most recipe sites publish) is used when there is one,
// otherwise its text. Pure helpers, plus the guarded fetch.
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

// The page, if it is public: every address the name resolves to is checked,
// and redirects are followed by hand (each one checked again).
async function fetchPage(raw, fetchFn = fetch, lookup = (h) => dns.lookup(h, { all: true })) {
  let u = checkUrl(raw);
  for (let hops = 0; u && hops < 4; hops++) {
    const addrs = await lookup(u.hostname).catch(() => []);
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('blocked');
    const r = await fetchFn(u.href, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (recipe reader)', accept: 'text/html,*/*;q=0.5' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = checkUrl(new URL(r.headers.get('location'), u).href); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.subarray(0, 2 * 1024 * 1024).toString('utf8');
  }
  throw new Error('bad link');
}

// What of a page is the recipe: its structured recipe if it has one (the
// ingredients and how many it serves), otherwise its plain text, shortened.
function recipeText(html) {
  const s = String(html || '');
  for (const m of s.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j;
    try { j = JSON.parse(m[1].trim()); } catch (_e) { continue; }
    const all = [].concat(j, j && j['@graph'] ? j['@graph'] : []).flat();
    const r = all.find((x) => x && (x['@type'] === 'Recipe' || (Array.isArray(x['@type']) && x['@type'].includes('Recipe'))));
    if (r && Array.isArray(r.recipeIngredient) && r.recipeIngredient.length) {
      const yieldText = [].concat(r.recipeYield || []).join(' ');
      return { title: String(r.name || '').slice(0, 80), text: 'מנות: ' + yieldText + '\nמצרכים:\n' + r.recipeIngredient.map(String).join('\n'), structured: true };
    }
  }
  const title = ((s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim().slice(0, 80);
  const text = s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return { title, text: text.slice(0, 9000), structured: false };
}

const RECIPE_PROMPT = `קיבלת מתכון (טקסט מאתר, טקסט שהודבק או תמונה). הוצא ממנו רק את המצרכים שצריך לקנות.
החזר JSON בלבד: {"title":"שם המנה","servings":4,"items":[{"name":"ביצים","qty":6,"unit":"יח'","aisle":"dairy","pantry":false}]}
- servings: לכמה מנות המתכון (אם לא כתוב, 4).
- name: שם המוצר כמו שכותבים ברשימת קניות, בלי הוראות הכנה ("בצל", לא "בצל קצוץ דק").
- qty מספר ו-unit (ק"ג, גרם, ליטר, מ"ל, יח', כפות, כפיות, כוסות, קופסאות, חבילות, או ריק). המר כשאפשר לכמות שקונים (למשל "2 כוסות קמח" -> 0.3 ק"ג).
- pantry:true למה שרוב הבתים כבר מחזיקים: מלח, פלפל שחור, סוכר, שמן, קמח, אורז, תבלינים, אבקת אפייה, סודה לשתייה, חומץ, מים.
- aisle אחד מ: produce, bakery, dairy, meat, dry, frozen, drinks, clean, care, baby, other.
- אם זה לא מתכון, החזר {"title":"","servings":0,"items":[]}.`;

module.exports = { privateIp, checkUrl, fetchPage, recipeText, RECIPE_PROMPT };
