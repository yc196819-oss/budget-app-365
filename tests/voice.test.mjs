import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpoken, wordsToNumbers } from '../public/app/src/domain/voice.js';

test('Hebrew number words become digits', () => {
  assert.equal(wordsToNumbers('שמונים'), '80');
  assert.equal(wordsToNumbers('מאה וחמישים שקל'), '150 שקל');
  assert.equal(wordsToNumbers('שלוש מאות ועשרים'), '320');
  assert.equal(wordsToNumbers('אלף וחמש מאות'), '1500');
  assert.equal(wordsToNumbers('21 אלף'), '21000');
  assert.equal(wordsToNumbers('2.5 אלף'), '2500');
  assert.equal(wordsToNumbers('אלפיים ושלוש מאות'), '2300');
  assert.equal(wordsToNumbers('קפה בארומה'), 'קפה בארומה');
});

test('what people say when adding an expense', () => {
  assert.deepEqual(parseSpoken('שילמתי 80 שקל בסופר'), { amount: 80, description: 'סופר', type: 'expense' });
  assert.deepEqual(parseSpoken('שילמתי שמונים שקל בסופר'), { amount: 80, description: 'סופר', type: 'expense' });
  assert.deepEqual(parseSpoken('קניתי דלק במאתיים וחמישים שקל'), { amount: 250, description: 'דלק', type: 'expense' });
  assert.deepEqual(parseSpoken('הוצאתי 46 שקל על קפה בארומה'), { amount: 46, description: 'קפה בארומה', type: 'expense' });
  assert.deepEqual(parseSpoken('46 קפה בארומה'), { amount: 46, description: 'קפה בארומה', type: 'expense' }, 'typed text works as before');
  assert.deepEqual(parseSpoken('ארוחה במסעדה 320 ש"ח.'), { amount: 320, description: 'ארוחה במסעדה', type: 'expense' });
});

test('income is recognized by itself', () => {
  assert.deepEqual(parseSpoken('קיבלתי משכורת 21 אלף'), { amount: 21000, description: 'משכורת', type: 'income' });
  assert.deepEqual(parseSpoken('נכנס החזר מביטוח לאומי 500 שקל'), { amount: 500, description: 'החזר מביטוח לאומי', type: 'income' });
  assert.equal(parseSpoken('בונוס אלפיים').type, 'income');
});

test('no amount or nothing but an amount: nothing to add', () => {
  assert.equal(parseSpoken('שילמתי בסופר'), null);
  assert.equal(parseSpoken('80 שקל'), null);
  assert.equal(parseSpoken(''), null);
});
