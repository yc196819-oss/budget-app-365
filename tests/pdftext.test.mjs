import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksReversed, turnLine, fixReversedHebrew, splitText, inParts } from '../public/app/src/domain/pdftext.js';

test('Hebrew a PDF gives backwards is turned around; numbers and Latin keep their order', () => {
  assert.equal(fixReversedHebrew('הנח ןוצפלוו'), 'וולפצון חנה');
  assert.equal(turnLine('ןומלוג 12.50 IKEA'), 'IKEA 12.50 גולמון');
  assert.equal(fixReversedHebrew('שופרסל דיל 12.50'), 'שופרסל דיל 12.50', 'right text stays');
  assert.equal(fixReversedHebrew('לטובת: יהודה עבור: משכנתא'), 'לטובת: יהודה עבור: משכנתא');
  assert.equal(fixReversedHebrew('עבור: מזהה 385695657'), 'עבור: מזהה 385695657', 'no final letters: no guess');
  assert.equal(looksReversed('םיקסע ןוכיח'), true);
  assert.equal(looksReversed('חיסכון עסקים'), false);
});

test('a long statement is cut between lines into parts, none lost and none too long', () => {
  const lines = Array.from({ length: 900 }, (_, i) => '2026-10-' + String((i % 28) + 1).padStart(2, '0') + ' שופרסל דיל ' + i + ' 123.45');
  const parts = splitText(lines.join('\n'), 10000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 10000));
  assert.deepEqual(parts.join('\n').split('\n'), lines);
  assert.equal(splitText('x'.repeat(30000), 10000)[0].length, 10000, 'one huge line is cut, not sent whole');
  assert.equal(splitText(lines.join('\n'), 1000, 3).length, 3);
  assert.deepEqual(splitText('  \n'), []);
});

test('parts are read a few at a time, in order', async () => {
  let running = 0, most = 0;
  const out = await inParts([1, 2, 3, 4, 5], 2, async (x) => { running++; most = Math.max(most, running); await new Promise((r) => setTimeout(r, 5)); running--; return x * 10; });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
  assert.equal(most, 2);
});
