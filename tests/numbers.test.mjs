import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignNumbers, truthsOf, asOfLabel } from '../public/app/src/domain/numbers.js';

test("the advisor's amounts are the card's amounts, exactly", () => {
  const truths = truthsOf({ amount: 3000, fx: { endBefore: 46797, endAfter: 43797, roomBefore: 2140, roomAfter: -860, month: 'נובמבר' } });
  // Ten answers the way a model writes them: copied, rounded a little, or off by a few shekels.
  const cases = [
    ['בסוף נובמבר יהיו בחשבון 46,771 ש"ח, ואחרי הקנייה 43,771.', 'בסוף נובמבר יהיו בחשבון 46,797 ש"ח, ואחרי הקנייה 43,797.'],
    ['₪46,800 בלי הקנייה, ₪43,800 איתה.', '₪46,797 בלי הקנייה, ₪43,797 איתה.'],
    ['נשארו 2,140 החודש, אחרי הקנייה חריגה של 860.', 'נשארו 2,140 החודש, אחרי הקנייה חריגה של 860.'],
    ['הקנייה של 3,000 מורידה את היתרה ל-43797.', 'הקנייה של 3,000 מורידה את היתרה ל-43797.'],
    ['43790 בסוף החודש.', '43797 בסוף החודש.'],
    ['יתרה של 46,797.', 'יתרה של 46,797.'],
    ['בשנת 2026 תהיה תחזית טובה.', 'בשנת 2026 תהיה תחזית טובה.'],
    ['משכנתא של 120,000 זה סיפור אחר.', 'משכנתא של 120,000 זה סיפור אחר.'],
    ['בערך 46,000 בסוף החודש.', 'בערך 46,000 בסוף החודש.'],
    ['נשארים 2,150 בתקציב.', 'נשארים 2,140 בתקציב.']
  ];
  for (const [said, shown] of cases) assert.equal(alignNumbers(said, truths), shown, said);
});

test('the numbers given to the advisor, and "as of" on an older answer', () => {
  assert.deepEqual([...truthsOf({ a: 12.4, b: [150.6, { c: -2400 }], d: 'x', e: null })].sort((x, y) => x - y), [151, 2400]);
  assert.equal(alignNumbers('אין מספרים', new Set()), 'אין מספרים');
  const now = new Date('2026-11-03T12:00:00');
  assert.equal(asOfLabel('2026-11-03T10:20:00', now), 'המספרים נכונים ל-3.11, 10:20');
  assert.equal(asOfLabel('2026-11-03T11:50:00', now), '', 'a fresh answer needs no date');
  assert.equal(asOfLabel(undefined, now), '');
});

import { fixSums } from '../public/app/src/domain/numbers.js';
test('a sum written out in an answer is checked; a wrong result is replaced, written the same way', () => {
  assert.equal(fixSums('יצאו 40+40+15+10 = 95 ש"ח'), 'יצאו 40+40+15+10 = 105 ש"ח');
  assert.equal(fixSums('20,000 פחות 15,500 פחות 3,000 = 2,000'), '20,000 פחות 15,500 פחות 3,000 = 1,500');
  assert.equal(fixSums('-50 - 30 + 100 = 40'), '-50 - 30 + 100 = 20');
  assert.equal(fixSums('500 + 900 + 300 + 5,000 = 6,600'), '500 + 900 + 300 + 5,000 = 6,700');
  assert.equal(fixSums('100 − 250 = 150'), '100 − 250 = −150');
  assert.equal(fixSums('₪1,000 + ₪500 = ₪1,600'), '₪1,000 + ₪500 = ₪1,500');
  // Right sums, dates and plain text stay as they are.
  for (const t of ['5,000 + 12,000 + 1,000 = 18,000', 'בין 10-12 בחודש', 'ב-10 בנובמבר', 'קנו 3 ועוד']) assert.equal(fixSums(t), t);
});
