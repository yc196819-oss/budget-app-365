import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseAll, basket, saving, equivalent, size, madeFrom, isFresh } from '../public/app/src/domain/prices.js';

// Ten households in different towns, family sizes and lists, priced against
// a sample of the real public price files (products and chain prices only:
// tests/fixtures/prices-sample.json, from the catalog's price_search).
const catalog = JSON.parse(readFileSync(new URL('./fixtures/prices-sample.json', import.meta.url), 'utf8'));
const ALL = Object.keys(catalog);
const FAMILIES = [
  { town: 'בית שמש', people: 9, pref: ['בד"ץ העדה החרדית'], list: ['חלב 3%', 'ביצים', 'לחם', 'קמח', 'סוכר', 'שמן', 'אורז', 'פסטה', 'עוף', 'חיתולים', 'מגבונים', 'במבה', 'קוטג', 'טחינה'] },
  { town: 'ביתר עילית', people: 7, pref: ['בד"ץ העדה החרדית', 'בד"ץ בית יוסף'], list: ['חלב 3%', 'ביצים', 'לחם', 'קמח', 'סוכר', 'שמן', 'פסטה', 'מרגרינה', 'שמנת', 'נייר טואלט', 'אבקת כביסה'] },
  { town: 'מודיעין עילית', people: 11, pref: ['בד"ץ העדה החרדית'], list: ALL },
  { town: 'בני ברק', people: 4, pref: ['הרב לנדא'], list: ['חלב 3%', 'לחם', 'קפה', 'תה', 'יוגורט', 'גבינה לבנה', 'קוטג', 'חומוס', 'טונה'] },
  { town: 'ירושלים', people: 6, pref: ['בד"ץ העדה החרדית', 'הרב רובין'], list: ['חלב 3%', 'ביצים', 'לחם', 'עגבניות', 'מלפפון', 'בצל', 'תפוחי אדמה', 'בננה', 'עוף', 'אורז'] },
  { town: 'גבעת זאב', people: 3, pref: 'any', list: ['חלב 3%', 'לחם', 'קפה', 'ופלים', 'במבה', 'שמנת'] },
  { town: 'עפולה', people: 5, pref: ['רבנות'], list: ['חלב 3%', 'ביצים', 'לחם', 'פסטה', 'טונה', 'שמן', 'סוכר', 'קפה'] },
  { town: 'צפת', people: 8, pref: ['בד"ץ העדה החרדית', 'בד"ץ בעלז'], list: ['חלב 3%', 'ביצים', 'לחם', 'קמח', 'סוכר', 'שמן', 'אורז', 'חיתולים', 'מגבונים', 'אבקת כביסה', 'נייר טואלט', 'מרגרינה'] },
  { town: 'אלעד', people: 10, pref: ['בד"ץ העדה החרדית'], list: ['חלב 3%', 'ביצים', 'לחם', 'קמח', 'סוכר', 'עוף', 'חיתולים', 'מגבונים', 'יוגורט', 'במבה', 'ופלים'] },
  { town: 'רמת בית שמש', people: 2, pref: ['רבנות מהדרין'], list: ['חלב 3%', 'לחם', 'קפה', 'תה', 'גבינה לבנה', 'עגבניות', 'מלפפון'] }
];
const run = (f, opts) => {
  const items = f.list.map((name, i) => ({ id: 'i' + i, name }));
  const choices = chooseAll(items, catalog, f.pref, opts);
  return { choices, rows: basket(choices, () => Math.max(1, Math.round(f.people / 4))) };
};

for (const f of FAMILIES) {
  test('a family in ' + f.town + ' (' + f.people + ' people) gets a fair price for its list', () => {
    const { choices, rows } = run(f);
    assert.equal(choices.length, f.list.length);
    // Every item is accounted for: picked, waiting for them, or said why not.
    for (const c of choices) assert.ok(['auto', 'unverified', 'unsure', 'fresh', 'none'].includes(c.status), c.query + ': ' + c.status);
    const priced = choices.filter((c) => c.pick);
    assert.ok(priced.length >= Math.ceil(f.list.length * 0.6), f.town + ': most of the list is priced (' + priced.length + '/' + f.list.length + ')');
    // What was typed is what was picked: no candy for sugar, no drink for a banana.
    for (const c of priced) {
      assert.ok(!madeFrom(c.pick.name, c.query) || !isFresh(c.query), c.query + ' → ' + c.pick.name);
      if (isFresh(c.query)) assert.ok(!madeFrom(c.pick.name, c.query), c.query + ' is fresh, not ' + c.pick.name);
    }
    // Chains: those with fewer missing first, cheaper first among equals.
    assert.ok(rows.length >= 3, 'compared at several chains');
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].missing < rows[i].missing || (rows[i - 1].missing === rows[i].missing && rows[i - 1].total <= rows[i].total));
    assert.ok(rows[0].total > 0);
    assert.ok(saving(rows) >= 0);
    // A swap is always an equivalent size of the picked product.
    for (const r of rows) for (const l of r.lines) {
      if (!l.swap) continue;
      const c = choices.find((x) => x.id === l.id);
      assert.ok(equivalent(c.pick, l.product) > 0, c.pick.name + ' ↔ ' + l.product.name);
    }
    // Strict: only confirmed kashrut, so nothing unverified.
    assert.ok(run(f, { strict: true }).choices.every((c) => c.status !== 'unverified'));
  });
}

test('basics are what was typed: sugar is sugar, flour is flour', () => {
  const pick = (q) => chooseAll([{ id: 1, name: q }], catalog, 'any')[0].pick;
  assert.match(pick('סוכר').name, /^סוכר(?!יות)/);
  assert.match(pick('קמח').name, /^קמח/);
  assert.match(pick('חלב 3%').name, /חלב.*3%/);
  assert.match(pick('אורז').name, /^אורז/);
});

test('sizes written with the base the chain prices by', () => {
  assert.deepEqual(size(750, '100 גרם'), { unit: 'kg', qty: 0.75 });
  assert.deepEqual(size(1, '1 קילוגרם'), { unit: 'kg', qty: 1 });
  assert.deepEqual(size(500, '100 מיליליטר'), { unit: 'l', qty: 0.5 });
  assert.equal(size(1, '100 גרם'), null, 'one gram is "sold by weight", not a size');
  assert.equal(equivalent({ qty: 1, unit: 'ליטר' }, { qty: 1000, unit: 'מיליליטר' }), 1);
  assert.equal(equivalent({ qty: 1, unit: 'ליטר' }, { qty: 200, unit: 'מיליליטר' }), 0);
  assert.equal(equivalent({ qty: 1, unit: 'ליטר' }, { qty: 1, unit: 'קילוגרם' }), 0);
});

test('a chain that sells once a week is marked, and the cheapest always-open chain is named too', async () => {
  const { chainNote, bestAlways } = await import('../public/app/src/domain/prices.js');
  assert.match(chainNote('mishnat-yosef').text, /פעם בשבוע/);
  assert.equal(chainNote('rami-levy'), null);
  const rows = [{ chain: 'mishnat-yosef', total: 90, missing: 0 }, { chain: 'x', total: 99, missing: 1 }, { chain: 'y', total: 101, missing: 0 }];
  assert.equal(bestAlways(rows).chain, 'y', 'the same number missing as the cheapest');
  assert.equal(bestAlways([{ chain: 'y', total: 1, missing: 0 }, rows[0]]), null, 'the cheapest is open every day');
});
