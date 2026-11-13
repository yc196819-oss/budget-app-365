// The demo household ("משפחת לוי (הדגמה)"): a year of made-up money up to
// today, built to show what the app does now: salaries, a supermarket
// budget, fixed costs worth a look (two streaming services, two health
// insurances, a cellular bill that went up), a transfer between their own
// accounts, a Bit refund, money into an investment, a shopping list with
// history and a receipt. Every name and amount is invented. Pure: the same
// day gives the same data.

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const round = (n) => Math.round(n * 100) / 100;

// A small seeded random, so a refresh on the same day builds the same data.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUPER = ['שופרסל דיל', 'רמי לוי שיווק השקמה', 'אושר עד', 'יוחננוף'];
const FOOD_OUT = ['פיצה שמש', 'קפה גרג', 'בורגר סאלון', 'פלאפל הזקן', 'שווארמה המושבה'];
const FUEL = ['פז', 'דלק', 'סונול'];
const CLOTHES = ['קסטרו', 'פוקס', 'H&M'];

// The household's categories by name (a child by "parent > child" too) →
// { category_id, subcategory_id }.
function catFinder(categories) {
  const byName = new Map();
  for (const c of categories) byName.set(c.name, c);
  return (name) => {
    const c = byName.get(name);
    if (!c) return { category_id: null, subcategory_id: null };
    return c.parent_id ? { category_id: c.parent_id, subcategory_id: c.id } : { category_id: c.id, subcategory_id: null };
  };
}

// The year of lines, oldest first, never after today.
//   ctx: { today: Date, categories, accounts: [david, michal], cards: [david's, michal's], userId }
function buildTransactions({ today = new Date(), categories = [], accounts = [], cards = [], userId = null } = {}) {
  const cat = catFinder(categories);
  const [accD, accM] = accounts;
  const [cardD, cardM] = cards;
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const out = [];
  const add = (day, row) => {
    if (day > end) return;
    out.push({ created_by: userId, spread: 'month', source: 'manual', nature: 'variable', ...row, tx_date: iso(day), amount: round(row.amount) });
  };
  const card = (c) => ({ payment_method: 'credit', card_id: c ? c.id : null, account_id: c ? c.bank_account_id : null });
  const order = (a) => ({ payment_method: 'standing_order', card_id: null, account_id: a ? a.id : null });

  for (let back = 11; back >= 0; back--) {
    const y = end.getUTCFullYear(), m = end.getUTCMonth() - back;
    const first = new Date(Date.UTC(y, m, 1));
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const on = (d) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, days)));
    const r = rng(first.getUTCFullYear() * 100 + first.getUTCMonth() + 7);
    const vary = (base, by) => base + (r() * 2 - 1) * by;
    const recent = back <= 1;

    // Income.
    add(on(1), { type: 'income', nature: 'fixed', description: 'משכורת מיכל', amount: vary(9800, 220), ...order(accM), ...cat('משכורת') });
    add(on(10), { type: 'income', nature: 'fixed', description: 'משכורת דוד', amount: vary(14200, 300), ...order(accD), ...cat('משכורת') });
    if (back % 3 === 1) add(on(18), { type: 'income', description: 'עבודה צדדית - עיצוב', amount: vary(1600, 300), ...order(accM), ...cat('עבודה צדדית / פרילנס') });

    // Fixed costs from the bank account.
    add(on(1), { type: 'expense', nature: 'fixed', description: 'שכירות', amount: 5200, ...order(accD), ...cat('שכירות / משכנתא') });
    add(on(5), { type: 'expense', nature: 'fixed', description: 'מעון יום - צהרון', amount: 1450, ...order(accD), ...cat('מעון/צהרון') });
    add(on(15), { type: 'expense', nature: 'fixed', description: 'ארנונה עיריית בית שמש', amount: 318, ...order(accD), ...cat('חשבונות') });
    if (back % 2 === 0) add(on(20), { type: 'expense', nature: 'fixed', description: 'חברת החשמל', amount: vary(470, 60), ...order(accD), ...cat('חשבונות') });

    // Fixed costs on a card: what the advisor's check looks at.
    add(on(1), { type: 'expense', nature: 'fixed', description: 'פרטנר תקשורת', amount: back === 0 ? 189.8 : 149.8, ...card(cardD), ...cat('חשבונות') });
    add(on(3), { type: 'expense', nature: 'fixed', description: 'הוט נט אינטרנט', amount: 119, ...card(cardD), ...cat('חשבונות') });
    add(on(7), { type: 'expense', nature: 'fixed', description: 'NETFLIX.COM', amount: 54.9, ...card(cardM), ...cat('תרבות') });
    add(on(9), { type: 'expense', nature: 'fixed', description: 'DISNEY PLUS', amount: 39.9, ...card(cardM), ...cat('תרבות') });
    add(on(4), { type: 'expense', nature: 'fixed', description: 'הראל ביטוח בריאות', amount: 118, ...card(cardD), ...cat('ביטוח בריאות') });
    add(on(6), { type: 'expense', nature: 'fixed', description: 'מגדל ביטוח בריאות', amount: 96, ...card(cardM), ...cat('ביטוח בריאות') });
    add(on(12), { type: 'expense', nature: 'fixed', description: 'איילון ביטוח רכב', amount: 245, ...card(cardD), ...cat('ביטוח רכב') });
    add(on(14), { type: 'expense', nature: 'fixed', description: 'מתנ"ס - חוג כדורגל', amount: 180, ...card(cardM), ...cat('חוגים') });

    // The supermarket: 6 to 8 times a month.
    const shops = 6 + Math.floor(r() * 3);
    for (let i = 0; i < shops; i++) add(on(2 + Math.floor((i * days) / shops)), { type: 'expense', description: SUPER[Math.floor(r() * SUPER.length)], amount: vary(390, 220), ...card(i % 3 ? cardD : cardM), ...cat('סופר') });
    // Eating out, fuel, a pharmacy, clothes now and then.
    const outs = 2 + Math.floor(r() * 3);
    for (let i = 0; i < outs; i++) add(on(4 + Math.floor(r() * (days - 4))), { type: 'expense', description: FOOD_OUT[Math.floor(r() * FOOD_OUT.length)], amount: vary(130, 60), ...card(cardM), ...cat('מסעדות ואוכל בחוץ') });
    for (let i = 0; i < 3; i++) add(on(3 + i * 9), { type: 'expense', description: FUEL[Math.floor(r() * FUEL.length)], amount: vary(290, 50), ...card(cardD), ...cat('דלק') });
    add(on(11 + Math.floor(r() * 10)), { type: 'expense', description: 'סופר-פארם', amount: vary(120, 50), ...card(cardM), ...cat('תרופות') });
    if (r() < 0.5) add(on(8 + Math.floor(r() * 15)), { type: 'expense', description: CLOTHES[Math.floor(r() * CLOTHES.length)], amount: vary(260, 120), ...card(cardM), ...cat('ביגוד') });
    if (r() < 0.3) add(on(16 + Math.floor(r() * 10)), { type: 'expense', description: 'מכבי שירותי בריאות - רופא', amount: vary(60, 20), ...card(cardD), ...cat('רופאים') });
    if (!recent && r() < 0.15) add(on(21), { type: 'expense', description: 'מוסך השלום', amount: vary(950, 300), ...card(cardD), ...cat('מוסך') });
  }

  // The last weeks: what the app asks about.
  const ago = (n) => new Date(end.getTime() - n * DAY);
  // Money between their own two accounts (the app asks if it is a transfer).
  add(ago(9), { type: 'expense', description: 'העברה לחשבון מיכל', amount: 3000, payment_method: 'transfer', card_id: null, account_id: accD && accD.id, category_id: null, subcategory_id: null });
  add(ago(8), { type: 'income', description: 'העברה מחשבון דוד', amount: 3000, payment_method: 'transfer', card_id: null, account_id: accM && accM.id, category_id: null, subcategory_id: null });
  // A dinner, and a friend's share back by Bit (the app asks: a refund?).
  add(ago(6), { type: 'expense', description: 'מסעדת הגפן', amount: 280, ...card(cardM), ...cat('מסעדות ואוכל בחוץ') });
  add(ago(5), { type: 'income', description: 'ביט - העברה מיוסי', amount: 140, payment_method: 'transfer', card_id: null, account_id: accM && accM.id, category_id: null, subcategory_id: null });
  // Money into an investment (the app asks: a deposit?).
  add(ago(12), { type: 'expense', description: 'העברה לאלטשולר שחם גמל להשקעה', amount: 1000, payment_method: 'transfer', card_id: null, account_id: accD && accD.id, category_id: null, subcategory_id: null });

  return out.sort((a, b) => a.tx_date.localeCompare(b.tx_date));
}

// The shopping list: what is on it now, and three finished shoppings (so
// "the previous list" and "what you usually buy" have something to show).
function buildShopping({ today = new Date() } = {}) {
  const at = (n) => new Date(today.getTime() - n * DAY).toISOString();
  const open = [['חלב 3%', '×3', 'dairy'], ['ביצים', null, 'dairy'], ['לחם', '×2', 'bakery'], ['קמח', null, 'dry'], ['סוכר', null, 'dry'], ['עגבניות', '1 ק"ג', 'produce'], ['קוטג׳', '×2', 'dairy'], ['חיתולים', null, 'baby'], ['שמן', null, 'dry'], ['אורז', null, 'dry']];
  const rows = open.map(([name, qty, aisle], i) => ({ name, qty, aisle, done: i === 4, created_at: at(1 - i * 0.01), done_at: i === 4 ? at(0.2) : null, cleared_at: null }));
  const past = [['חלב 3%', 'dairy'], ['לחם', 'bakery'], ['ביצים', 'dairy'], ['גבינה לבנה', 'dairy'], ['במבה', 'dry'], ['טחינה', 'dry'], ['פסטה', 'dry'], ['מגבונים', 'baby'], ['בננות', 'produce'], ['מלפפונים', 'produce']];
  for (const [n, d] of [[0, 21], [1, 14], [2, 7]]) {
    for (const [name, aisle] of past.slice(n, n + 8)) rows.push({ name, qty: null, aisle, done: true, created_at: at(d + 1), done_at: at(d), cleared_at: at(d) });
  }
  return rows;
}

// One receipt from last week.
function buildReceipt({ today = new Date() } = {}) {
  return {
    store: 'רמי לוי שיווק השקמה',
    bought_on: iso(new Date(today.getTime() - 7 * DAY)),
    total: 286.4,
    items: [
      { name: 'חלב 3% בשקית 1 ליטר', qty: 3, price: 18.6 }, { name: 'לחם אחיד פרוס', qty: 2, price: 14.8 },
      { name: 'ביצים L 12 יח׳', qty: 1, price: 13.9 }, { name: 'קמח לבן 1 ק"ג', qty: 2, price: 9.8 },
      { name: 'גבינה לבנה 5% 250 גרם', qty: 2, price: 11.8 }, { name: 'טחינה גולמית 500 גרם', qty: 1, price: 14.9 },
      { name: 'חיתולים שלב 4', qty: 1, price: 54.9 }, { name: 'עוף שלם טרי', qty: 1, price: 147.7 }
    ]
  };
}

module.exports = { buildTransactions, buildShopping, buildReceipt, catFinder, rng };
