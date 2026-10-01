import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, signed, dateLabel, greeting, initials } from '../public/app/src/domain/format.js';

test('money rounds and adds thousands separators', () => {
  assert.equal(money(1234.5), '₪1,235');
  assert.equal(money(-980), '₪980');
  assert.equal(money('abc'), '₪0');
});

test('signed uses a real minus sign', () => {
  assert.equal(signed(-690), '−₪690');
  assert.equal(signed(18400), '+₪18,400');
});

test('dateLabel is Hebrew weekday, day and month', () => {
  assert.equal(dateLabel(new Date(2026, 8, 19)), 'שבת, 19 בספטמבר');
  assert.equal(dateLabel(new Date(2026, 9, 1)), 'יום ה׳, 1 באוקטובר');
});

test('greeting follows the hour', () => {
  assert.equal(greeting(new Date(2026, 0, 1, 8)), 'בוקר טוב');
  assert.equal(greeting(new Date(2026, 0, 1, 19)), 'ערב טוב');
});

test('initials from a household name or an email', () => {
  assert.equal(initials('יוסי ודני', 'x@y.com'), 'יד');
  assert.equal(initials('', 'dana@example.com'), 'DA');
  assert.equal(initials('', ''), '?');
});
