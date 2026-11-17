const test = require('node:test');
const assert = require('node:assert/strict');
const { parseImport, shapeOf } = require('../server/importParse');

const row = { date: '2026-11-02', description: 'סופר בדוי', amount: 120.5, type: 'expense' };

test('a clean list, a fenced list, words around it, a wrapper object', () => {
  assert.deepEqual(parseImport(JSON.stringify([row])), [row]);
  assert.deepEqual(parseImport('```json\n' + JSON.stringify([row]) + '\n```'), [row]);
  assert.deepEqual(parseImport('הנה התנועות:\n```json\n' + JSON.stringify([row]) + '\n```\nסה"כ שורה אחת.'), [row]);
  assert.deepEqual(parseImport(JSON.stringify({ transactions: [row] })), [row]);
});

test('a thousands separator and a trailing comma are repaired', () => {
  const r = parseImport('[{"date":"2026-11-02","description":"רהיטים בדויים","amount":1,234.50,"type":"expense"},]');
  assert.equal(r.length, 1);
  assert.equal(r[0].amount, 1234.5);
});

test('a part with no transactions is empty, not a failure', () => {
  assert.deepEqual(parseImport('[]'), []);
  assert.deepEqual(parseImport('בקטע הזה אין עסקאות, רק סיכום החיובים של הכרטיס.'), []);
  assert.deepEqual(parseImport('{"summary":"דף פתיחה","total":1840}'), []);
});

test('still unreadable: null (a cut-off list is not guessed at)', () => {
  assert.equal(parseImport('[{"date":"2026-11-02","description":"סופר בדוי","amount":12'), null);
  assert.equal(parseImport('אני לא בטוח מה זה הקובץ'), null);
  assert.equal(parseImport(''), null);
});

test('the error log gets the shape of the answer, never its content', () => {
  assert.equal(shapeOf('הנה [ חלקי'), 'len=10 bracket=1 brace=0 fence=0');
});
