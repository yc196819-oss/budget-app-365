// Payment notifications sent from the household's own phone (an automation
// app such as MacroDroid forwards each Google Wallet notification here).
// Each phone gets a personal key that can only add notifications to its
// household: the server keeps only the key's hash. Pure helpers.

const crypto = require('crypto');

const KEY_PREFIX = 'bk_';
const MAX_TEXT = 500;

function newKey() {
  return KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

// A key as the phone sends it: "Bearer bk_…", "bk_…", or nothing usable.
function keyFrom(header) {
  const raw = String(header || '').trim().replace(/^Bearer\s+/i, '').trim();
  return /^bk_[A-Za-z0-9_-]{20,64}$/.test(raw) ? raw : null;
}

// Invisible direction marks and odd spaces that phones put around numbers.
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

// What the phone sent: plain text (the title on the first line, the
// notification's words after it: nothing to escape, so a name like בע"מ or
// H&M arrives whole), or a JSON or form body. Unknown fields are dropped.
function readBody(body) {
  if (typeof body === 'string') {
    const i = body.indexOf('\n');
    body = i < 0 ? { text: body } : { title: body.slice(0, i), text: body.slice(i + 1) };
  }
  const b = body && typeof body === 'object' ? body : {};
  const out = {
    app: clean(b.app || b.package).slice(0, 100),
    title: clean(b.title),
    text: clean(b.text || b.body || b.message)
  };
  return out.title || out.text ? out : null;
}

// The same notification sent twice (phones repeat them when they update)
// is kept once: same household, same words, same minute.
function fingerprint(householdId, { title, text }, at = new Date()) {
  const minute = new Date(at).toISOString().slice(0, 16);
  return crypto.createHash('sha256').update([householdId, title, text, minute].join('|')).digest('hex');
}

const CURRENCIES = [
  { code: 'ILS', re: /₪|ש"ח|ש״ח|\bILS\b|\bNIS\b/i },
  { code: 'USD', re: /\$|\bUSD\b/i },
  { code: 'EUR', re: /€|\bEUR\b/i },
  { code: 'GBP', re: /£|\bGBP\b/i }
];
const AMOUNT = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;

// Amount, currency, merchant and the card's last 4 digits, read from a
// Wallet notification ("Shufersal" / "₪45.90 with Mastercard •••• 4821").
// Anything not found stays null: the raw words are always kept as well.
function parseWallet({ title, text } = {}) {
  const t = clean(title);
  const x = clean(text);
  const all = (t + ' ' + x).trim();
  const out = { amount: null, currency: null, merchant: null, last4: null };

  // The amount is the number next to a currency sign; otherwise the first
  // number with decimals.
  for (const part of [x, t]) {
    for (const c of CURRENCIES) {
      const m = part.match(new RegExp('(?:' + c.re.source + ')\\s*' + AMOUNT.source, 'i')) || part.match(new RegExp(AMOUNT.source + '\\s*(?:' + c.re.source + ')', 'i'));
      if (m) {
        const num = m.slice(1).find((g) => g && /\d/.test(g));
        out.amount = Number(num.replace(/,/g, ''));
        out.currency = c.code;
        break;
      }
    }
    if (out.amount != null) break;
  }
  if (out.amount == null) {
    const m = all.match(/(\d{1,3}(?:,\d{3})*\.\d{2})/);
    if (m) out.amount = Number(m[1].replace(/,/g, ''));
  }
  if (!(out.amount > 0)) out.amount = null;

  // Last 4: four digits after the card dots or a card word.
  const l4 = all.match(/(?:[•·*●∙.]{2,}|xx+|(?:card|כרטיס|visa|mastercard|ויזה|מאסטרקארד|amex|diners|isracard|ישראכרט|max|מקס)[^\d]{0,12})\s*(\d{4})\b/i);
  if (l4) out.last4 = l4[1];

  // The merchant is the title, unless the title is only the app name or
  // holds the amount itself.
  const hasMoney = CURRENCIES.some((c) => c.re.test(t));
  if (t && !/^(google\s*)?(wallet|pay|ארנק)/i.test(t) && !hasMoney) out.merchant = t;
  else {
    const m = x.match(/(?:\bat\b|ב-|אצל\s)\s*([^\d•·*●,.]{2,40})/i);
    if (m) out.merchant = clean(m[1]);
  }
  return out;
}

module.exports = { KEY_PREFIX, newKey, hashKey, keyFrom, clean, readBody, fingerprint, parseWallet };
