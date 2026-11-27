import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aisleOf, parseItems } from '../public/app/src/domain/shopping.js';

// What 15 made-up households across the country typed into the list, and
// where each thing belongs in the store. Found in the Shabbat testing rounds.
const pairs = (line) => parseItems(line).map((i) => [i.name, i.qty, i.aisle]);

test('round 1: a word counts only where a word starts ("קמח רגיל" is flour, "פיתות" are pitas)', () => {
  assert.equal(aisleOf('קמח רגיל'), 'dry', 'not "גיל" (dairy) inside "רגיל"');
  assert.equal(aisleOf('מלח רגיל'), 'dry');
  assert.equal(aisleOf('פיתות'), 'bakery', 'not "תות" (strawberries)');
  assert.equal(aisleOf('חלבה'), 'dry', 'halva is not milk');
  assert.equal(aisleOf('שומשום'), 'dry', 'sesame is not garlic');
  assert.equal(aisleOf('לכביסה'), 'clean', 'one prefix letter is fine');
});

test('round 1: the first thing named is what the item is', () => {
  assert.equal(aisleOf('רוטב עגבניות'), 'dry');
  assert.equal(aisleOf('רסק עגבניות'), 'dry');
  assert.equal(aisleOf('מיץ ענבים'), 'drinks');
  assert.equal(aisleOf('משקה שקדים'), 'drinks');
  assert.equal(aisleOf('דייסת אורז'), 'baby');
  assert.equal(aisleOf('לחמניות המבורגר'), 'bakery');
  assert.equal(aisleOf('סבון כלים'), 'clean', 'a longer match at the same place still wins');
});

test('round 1: everyday things that had no department', () => {
  for (const [n, a] of [['פרגיות', 'meat'], ['כנפיים', 'meat'], ['קבב', 'meat'], ['ביסקוויטים', 'dry'], ['חמאת בוטנים', 'dry'], ['קינואה', 'dry'], ['בצק עלים', 'frozen'], ['ספרייט', 'drinks'], ['תפוזינה', 'drinks'], ['נרות שבת', 'clean'], ['גפרורים', 'clean'], ['שקיות זבל', 'clean']]) {
    assert.equal(aisleOf(n), a, n);
  }
});

test('round 1: "ו" joins two things only when the second is a thing ("תה ויסוצקי" stays one)', () => {
  assert.deepEqual(pairs('תה ויסוצקי'), [['תה ויסוצקי', null, 'dry']]);
  assert.deepEqual(pairs('לחם ועגבניות'), [['לחם', null, 'bakery'], ['עגבניות', null, 'produce']]);
  assert.deepEqual(pairs('יין לקידוש ונרות שבת'), [['יין לקידוש', null, 'drinks'], ['נרות שבת', null, 'clean']]);
});

test('round 1: a package word without a number is part of the name', () => {
  assert.deepEqual(pairs('שקיות זבל'), [['שקיות זבל', null, 'clean']]);
  assert.deepEqual(pairs('2 שקיות חלב'), [['חלב', '2 שקיות', 'dairy']]);
  assert.deepEqual(pairs('קילו עגבניות'), [['עגבניות', '1 ק"ג', 'produce']], 'a weight needs no number');
});

test('round 1: a thing whose name starts with "ו" keeps it ("ויסקי", "ופלים"); "ולחם" is bread', () => {
  assert.deepEqual(pairs('בירה, ויסקי, ופלים, ולחם'), [['בירה', null, 'drinks'], ['ויסקי', null, 'drinks'], ['ופלים', null, 'dry'], ['לחם', null, 'bakery']]);
});

test('round 2: "how much you paid" read as people type it ("352,90" is not 35,290)', async () => {
  const { typedAmount } = await import('../public/app/src/domain/shopTrips.js');
  assert.equal(typedAmount('352,90'), 352.9);
  assert.equal(typedAmount('352.90'), 352.9);
  assert.equal(typedAmount('₪ 1,234.50'), 1234.5);
  assert.equal(typedAmount('1,234'), 1234);
  assert.equal(typedAmount('420 ש"ח'), 420);
  assert.equal(typedAmount('35..2'), 0);
  assert.equal(typedAmount('הרבה'), 0);
  assert.equal(typedAmount(''), 0);
});

test('round 4: a recipe shared as a title and a link is read by its link; a whole recipe is not', async () => {
  const { recipeLink } = await import('../public/app/src/domain/shopList.js');
  assert.equal(recipeLink('שקשוקה של סבתא\nhttps://recipes.example.co.il/shakshuka'), 'https://recipes.example.co.il/shakshuka');
  assert.equal(recipeLink('תראו איזה מתכון (https://x.example/a?b=1).'), 'https://x.example/a?b=1');
  assert.equal(recipeLink('https://x.example/a'), 'https://x.example/a');
  assert.equal(recipeLink('2 כוסות קמח, 3 ביצים, כוס סוכר, חצי כוס שמן, שקית אבקת אפייה, כפית וניל, מערבבים הכול ואופים בתנור שחומם מראש ל-180 מעלות כ-40 דקות. מקור: https://x.example/cake'), '', 'a whole recipe stays text');
  assert.equal(recipeLink('בלי קישור'), '');
});
