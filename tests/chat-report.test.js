const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../server/chatReport.js');

test('chat report: amounts are only ones written in the conversation; lists are trimmed; no summary, no report', () => {
  const convo = 'יוסי: החלטנו רכב 700 בחודש, ויש לנו 15,000 בקרן החירום\nיועץ: מצוין. נשארו כ-1,200 ₪ לאוכל.';
  assert.deepEqual([...r.amountsIn(convo)].sort((a, b) => a - b), [700, 1200, 15000]);
  const rep = r.pickReport({
    summary: 'דיברתם על הרכב ועל קרן החירום.',
    decisions: ['רכב 700 בחודש', '', 'א'.repeat(400)],
    tasks: ['לעדכן את הביטוח'],
    amounts: [{ label: 'תקציב רכב', amount: 700 }, { label: 'קרן חירום', amount: '15000' }, { label: 'מספר שהומצא', amount: 9999 }, { label: '', amount: 1200 }]
  }, convo);
  assert.deepEqual(rep.amounts, [{ label: 'תקציב רכב', amount: 700 }, { label: 'קרן חירום', amount: 15000 }], 'an amount nobody wrote is dropped');
  assert.equal(rep.decisions.length, 2);
  assert.equal(rep.decisions[1].length, 160);
  assert.deepEqual(rep.tasks, ['לעדכן את הביטוח']);
  assert.equal(r.pickReport({ summary: '', decisions: ['x'] }, convo), null);
  assert.equal(r.pickReport(null, convo), null);
  assert.match(r.reportPrompt('2026-11-18'), /בלי מספרים שלא נכתבו בה/);
});
