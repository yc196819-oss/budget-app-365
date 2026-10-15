const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX, clipBody, dailyCap } = require('../server/limits');

test('long text is cut before it reaches the AI; files and objects are left alone', () => {
  const body = clipBody({ message: 'א'.repeat(50000), text: 'ב'.repeat(50000), fileData: 'x'.repeat(30000), summary: { a: 1 },
    history: Array.from({ length: 60 }, (_, i) => ({ role: 'user', text: 'ג'.repeat(9000), i })) });
  assert.equal(body.message.length, MAX.message);
  assert.equal(body.text.length, MAX.text);
  assert.equal(body.fileData.length, 30000, 'statements keep their content');
  assert.deepEqual(body.summary, { a: 1 });
  assert.equal(body.history.length, MAX.history);
  assert.equal(body.history[0].i, 40, 'the newest messages are kept');
  assert.equal(body.history[0].text.length, MAX.item);
  assert.equal(clipBody(null), null);
});

test('the whole service stops calling the AI past the daily cap, and starts again the next day', () => {
  const cap = dailyCap(3);
  assert.deepEqual([1, 2, 3, 4].map(() => cap.take('2026-10-15')), [true, true, true, false]);
  assert.equal(cap.take('2026-10-16'), true);
  assert.equal(cap.used, 1);
});
