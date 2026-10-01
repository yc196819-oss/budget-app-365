const { test } = require('node:test');
const assert = require('node:assert/strict');
const { convoText, learnPrompt, parseLoose, pickItems } = require('../server/learn');

test('the answer is read even when wrapped in a fence or a sentence', () => {
  assert.deepEqual(parseLoose('```json\n{"items":[]}\n```'), { items: [] });
  assert.deepEqual(parseLoose('הנה: {"items":[{"kind":"memory","text":"x"}]} בהצלחה'), { items: [{ kind: 'memory', text: 'x' }] });
  assert.equal(parseLoose('אין לי מה להציע'), null);
  assert.equal(parseLoose('{broken'), null);
});

test('only known kinds pass, at most 15', () => {
  const items = pickItems({ items: [{ kind: 'memory', text: 'a' }, { kind: 'drop_table' }, null, 'x', ...Array(20).fill({ kind: 'goal' })] });
  assert.equal(items[0].kind, 'memory');
  assert.equal(items.length, 15);
  assert.ok(items.every((i) => i.kind !== 'drop_table'));
  assert.deepEqual(pickItems(null), []);
});

test('the conversation text names who spoke and drops the follow-up suggestions', () => {
  const t = convoText([{ role: 'user', author: 'דני', text: 'החלטנו לחסוך' }, { role: 'ai', text: 'מצוין.\n@@הצעות: כמה?|מתי?' }, { role: 'system', text: 'x' }]);
  assert.equal(t, 'דני: החלטנו לחסוך\nיועץ: מצוין.\n');
});

test('the prompt carries the household data and today', () => {
  const p = learnPrompt({ goals: [{ id: 'g1', name: 'קרן חירום' }] }, '2026-10-01');
  assert.match(p, /2026-10-01/);
  assert.match(p, /קרן חירום/);
  assert.match(p, /"items"/);
});
