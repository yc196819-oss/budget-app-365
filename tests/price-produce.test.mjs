import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseAll, basket, count, searchTerm, looser, isFresh } from '../public/app/src/domain/prices.js';
import { produceOf, freshTerm } from '../public/app/src/domain/produce.js';

// Fresh food in a recipe ("4 עגבניות", "1 שום") priced as it is sold: by
// the kilo or by the piece, never a kilo price paid per piece, never dried
// tomatoes for tomatoes or a kilo of peeled garlic for one head.
// tests/fixtures/produce-sample.json: the chains' public prices for these
// searches on 2026-11-25 (products and chain prices only), as price_search
// returns them with the plainest names at every chain.
const sample = JSON.parse(readFileSync(new URL('./fixtures/produce-sample.json', import.meta.url), 'utf8'));
const catalogFor = (names) => {
  const out = {};
  for (const name of names) {
    const t = searchTerm(name);
    let found = (sample[t] || []).map((p) => ({ ...p, by: t, kosher: {} }));
    if (!found.length) { const l = looser(t); if (l) found = (sample[l] || []).map((p) => ({ ...p, by: l, kosher: {} })); }
    out[name] = found;
  }
  return out;
};
const price = (lines) => {
  const items = lines.map(([name, qty], i) => ({ id: 'l' + i, name, qty }));
  const choices = chooseAll(items, catalogFor(lines.map((l) => l[0])), 'any');
  const rows = basket(choices, (c) => count(items.find((l) => l.id === c.id).qty, c.pick, c.query));
  return { items, choices, rows };
};
const P = (barcode, name, qty, unit, offers) => ({ barcode, name, qty, unit, kosher: {}, offers: offers.map(([chain, p]) => ({ chain, chain_name: chain, price: p })) });

// The most each line can cost anywhere (generous: a dear month, a small
// shop, or the smallest pack a chain sells, 250 grams of ginger for 50).
const RECIPE = [
  ['עגבניות', "4 יח'", 16], ['עגבנייה', "1 יח'", 5], ['מלפפונים', "3 יח'", 10], ['בצל', "2 יח'", 6], ['בצל סגול', "1 יח'", 4],
  ['שום', "1 יח'", 10], ['שיני שום', "4 יח'", 10], ['פלפל אדום', "2 יח'", 14], ['פלפל אדום מתוק', "1 יח'", 8], ['פלפל צהוב', "1 יח'", 8],
  ['פלפל חריף', "1 יח'", 8], ['גזר', "3 יח'", 5], ['תפוחי אדמה', '1 ק"ג', 12], ['תפוחי אדמה', "4 יח'", 10], ['בטטה', "2 יח'", 12],
  ['חציל', "2 יח'", 14], ['קישואים', "3 יח'", 15], ['לימון', "1 יח'", 6], ['תפוחים', "4 יח'", 18], ['בננות', "6 יח'", 18],
  ['אבוקדו', "2 יח'", 20], ['חסה', "1 יח'", 16], ['כרוב', "1 יח'", 25], ['כרובית', "1 יח'", 20], ['ברוקולי', "1 יח'", 22],
  ['פטרוזיליה', '1 צרור', 10], ['כוסברה', '1 צרור', 10], ['שמיר', '1 צרור', 10], ['נענע', '1 צרור', 10], ['בצל ירוק', '1 צרור', 10],
  ["ג'ינג'ר", '50 גרם', 15], ['פטריות', '250 גרם', 18], ['סלק', "2 יח'", 8], ['דלעת', '500 גרם', 15], ['עגבניות שרי', '250 גרם', 22],
  ['פילה דג מושט', "4 יח'", 110], ['פילה סלמון', '600 גרם', 135], ['חזה עוף', '1 ק"ג', 70], ['שוקיים', "6 יח'", 45],
  ['בשר טחון', '500 גרם', 50], ['עוף שלם', "1 יח'", 70], ['פילה אמנון', "4 יח'", 110], ['פלפלים אדומים יבשים חריפים', "2 יח'", 10]
];

test('no recipe line costs more than it can, at any chain (44 fresh items, real prices)', () => {
  const { choices, rows } = price(RECIPE);
  const over = [];
  for (const r of rows) for (const l of r.lines) {
    if (!l.product) continue;
    const [name, qty, cap] = RECIPE[Number(l.id.slice(1))];
    if (l.cost > cap) over.push(`${name} ${qty} at ${r.chain}: ₪${l.cost} (${l.product.name})`);
  }
  assert.deepEqual(over, []);
  // And nearly all of them are priced.
  assert.ok(choices.filter((c) => c.pick).length >= RECIPE.length - 1, choices.filter((c) => !c.pick).map((c) => c.query).join(', '));
});

test('the recipe from the report: tomatoes, garlic, a red pepper, coriander, dried chilies, fish fillet', () => {
  const { choices, rows } = price([['פלפל אדום מתוק', "1 יח'"], ['עגבניות', "4 יח'"], ['שום', "1 יח'"], ['כוסברה', '1 צרור'], ['פלפלים אדומים יבשים חריפים', "2 יח'"], ['פילה דג מושט', "4 יח'"]]);
  const [pepper, tomato, garlic, coriander, chili, fish] = choices;
  // Fresh, not dried, stuffed, crushed or a mixed bag of herbs.
  assert.doesNotMatch(pepper.pick.name, /יבש|ממולא|קלוי/);
  assert.doesNotMatch(tomato.pick.name, /לחות|מיובש|מרוסק|קצוצ|שימור/);
  assert.doesNotMatch(garlic.pick.name, /קלוף|כתוש|גבישי|אבקה/);
  assert.doesNotMatch(coriander.pick.name, /\//);
  // Found though the chains write them otherwise.
  assert.match(chili.pick.name, /חריף/);
  assert.match(fish.pick.name, /פילה מושט/);
  const rami = rows.find((r) => r.chain === 'rami-levy');
  const at = (i) => rami.lines.find((l) => l.id === 'l' + i);
  // Four tomatoes are about 600 grams: ₪5 to ₪12, not ₪40.
  assert.ok(at(1).cost >= 4 && at(1).cost <= 12, 'tomatoes ₪' + at(1).cost);
  // One head of garlic: a few shekels, not ₪25.
  assert.ok(at(2).cost <= 6, 'garlic ₪' + at(2).cost);
  assert.ok(at(0).cost <= 4, 'one pepper ₪' + at(0).cost);
  // Dried chilies: one pack, whatever the recipe counts.
  assert.equal(at(4).cost, at(4).price);
});

test('pieces become a weight for what is sold by the kilo', () => {
  const tomato = P('1', 'עגבניה מגי', 1, 'קילוגרם', [['a', 12.9]]);
  assert.equal(count("4 יח'", tomato, 'עגבניות'), 0.6);
  assert.equal(count("1 יח'", tomato, 'עגבנייה'), 0.2, 'at least a tenth, rounded');
  const garlic = P('2', 'שום טרי', 1, 'ק"ג', [['a', 30]]);
  assert.equal(count("1 יח'", garlic, 'שום'), 0.1);
  // A packed kilo is bought whole when most of it is used, else only the
  // part used counts (a recipe's 3 carrots are not a kilo).
  const bag = P('3', 'גזר ארוז', 1, '1 קילוגרם', [['a', 5.9]]);
  assert.equal(count("6 יח'", bag, 'גזר'), 1);
  assert.equal(count("3 יח'", bag, 'גזר'), 0.3);
  assert.equal(count("1 יח'", P('8', 'פלפל חריף ארוז 6 יח', 6, 'יחידות', [['a', 10.9]]), 'פלפל חריף'), 0.17);
  // Sold by the piece: pieces, and cloves are part of a head; a pair is two.
  const head = P('4', 'שום יבש שרוול', 1, 'יחידות', [['a', 3.9]]);
  assert.equal(count("4 יח'", head, 'שיני שום'), 1);
  const pair = P('5', 'אבוקדו בשל זוג', 1, 'יחידות', [['a', 12.9]]);
  assert.equal(count("2 יח'", pair, 'אבוקדו'), 1);
  assert.equal(count("4 יח'", pair, 'אבוקדו'), 2);
  // A pack of dried chilies serves the recipe.
  const chili = P('6', 'פלפל חריף יבש', null, null, [['a', 9.9]]);
  assert.equal(count("2 יח'", chili, 'פלפלים אדומים יבשים חריפים'), 1);
  // Not fresh food: as before.
  assert.equal(count("4 יח'", P('7', 'יוגורט 200 גרם', 200, 'גרם', [['a', 3]]), 'יוגורט'), 4);
});

test('a chain that writes a kilo price as "per unit" is counted by the kilo', () => {
  const loose = P('1', 'בצל יבש', 1, 'קילוגרם', [['a', 5.9], ['b', 6.9], ['c', 5.5]]);
  const unit = P('2', 'בצל', 1, 'יחידה', [['d', 6.9]]);
  const items = [{ id: 'x', name: 'בצל', qty: "2 יח'" }];
  const [c] = chooseAll(items, { 'בצל': [loose, unit] }, 'any');
  assert.equal(c.pick.barcode, '1');
  const rows = basket([c], (cc) => count("2 יח'", cc.pick, cc.query));
  const d = rows.find((r) => r.chain === 'd');
  // 300 grams at ₪6.90 a kilo, not two "units" of ₪6.90.
  assert.equal(d.lines[0].cost, 2.07);
});

test('a price dearer than the food can cost is left out', () => {
  // ₪100 a kilo of dill is a mistake in a file; the bunch is ₪3.90.
  const bunch = P('1', 'שמיר ארוז', 1, 'יחידות', [['a', 3.9], ['b', 4.9]]);
  const wrong = P('2', 'שמיר עלים', 1, 'קילוגרם', [['b', 100]]);
  const [c] = chooseAll([{ id: 'x', name: 'שמיר' }], { 'שמיר': [bunch, wrong] }, 'any');
  const rows = basket([c], (cc) => count('1 צרור', cc.pick, cc.query));
  assert.ok(rows.every((r) => r.lines.every((l) => !l.product || l.cost < 10)));
  // One tomato is never ₪25.
  const odd = P('3', 'עגבניה', 1, 'יחידה', [['a', 25]]);
  const [t] = chooseAll([{ id: 'y', name: 'עגבניות' }], { 'עגבניות': [odd] }, 'any');
  assert.equal(t.pick, null);
});

test('fresh food is not another food that starts the same', () => {
  const potato = P('1', 'תפוח אדמה לבן', 1, 'קילוגרם', [['a', 4.9]]);
  const apple = P('2', 'תפוח עץ גאלה', 1, 'קילוגרם', [['a', 12.9]]);
  const [c] = chooseAll([{ id: 'x', name: 'תפוחים' }], { 'תפוחים': [potato, apple] }, 'any');
  assert.equal(c.pick.barcode, '2');
  const green = P('3', 'בצל ירוק', 1, 'יחידות', [['a', 4.9]]);
  const onion = P('4', 'בצל יבש', 1, 'קילוגרם', [['a', 5.9]]);
  const [o] = chooseAll([{ id: 'y', name: 'בצל' }], { 'בצל': [green, onion] }, 'any');
  assert.equal(o.pick.barcode, '4');
  assert.equal(produceOf('עגבניות').group, produceOf('עגבניה מגי').group);
  assert.equal(produceOf('שיני שום').group, produceOf('שום יבש').group);
  assert.notEqual(produceOf('פילה מושט').group, produceOf('מושט שלם').group);
});

test('the search finds fresh food as the chains write it', () => {
  assert.equal(searchTerm('עגבניות'), 'עגבני', 'finds "עגבניה מגי" too');
  assert.equal(searchTerm('פלפל אדום מתוק'), 'פלפל אדום');
  assert.equal(searchTerm('פילה דג מושט'), 'פילה מושט');
  assert.equal(searchTerm('שיני שום'), 'שום');
  assert.equal(searchTerm('פלפלים אדומים יבשים חריפים'), 'פלפל אדום יבש חריף');
  assert.equal(looser('פלפל אדום יבש חריף'), 'פלפל יבש חריף', 'the colour goes first');
  assert.equal(freshTerm('עגבניות טריות גדולות'), 'עגבני');
  assert.ok(isFresh('פלפל אדום מתוק'));
  assert.ok(isFresh('בצל ירוק'));
  assert.ok(isFresh('מלפפונים'));
  assert.equal(searchTerm('חלב 3%'), 'חלב 3%', 'anything else as before');
});
