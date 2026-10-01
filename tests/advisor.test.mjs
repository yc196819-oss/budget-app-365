import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply, buildSummary, starters, newTitle, normalizeMessages, adviceText, historyFor, parseSse, SUGG_MARK } from '../public/app/src/domain/advisor.js';

test('parseReply splits the answer from the follow-up suggestions', () => {
  assert.deepEqual(parseReply('כדאי לקצץ באוכל בחוץ.\n' + SUGG_MARK + ' כמה בדיוק? | ומה עם הרכב?|'), { text: 'כדאי לקצץ באוכל בחוץ.', suggestions: ['כמה בדיוק?', 'ומה עם הרכב?'] });
  assert.deepEqual(parseReply('תשובה בלי הצעות'), { text: 'תשובה בלי הצעות', suggestions: [] });
  assert.equal(parseReply('טקסט @@FIX:{"x":1}').text, 'טקסט');
  assert.deepEqual(parseReply(''), { text: '', suggestions: [] });
});

test('the summary has the shape the server prompt expects, plus the screen', () => {
  const today = new Date(2026, 9, 15);
  const categories = [{ id: 'food', name: 'אוכל', parent_id: null, kind: 'expense' }, { id: 'super', name: 'סופר', parent_id: 'food', kind: 'expense' }];
  const txs = [
    { type: 'expense', amount: 300, tx_date: '2026-10-05', category_id: 'food', subcategory_id: 'super', created_by: 'u1', spread: 'month' },
    { type: 'expense', amount: 200, tx_date: '2026-09-05', category_id: 'food', created_by: 'u2', spread: 'month' },
    { type: 'income', amount: 9000, tx_date: '2026-10-01', created_by: 'u1', spread: 'month' }
  ];
  const s = buildSummary({ txs, categories, budgets: [{ category_id: 'food', monthly_amount: 1000 }], goals: [{ name: 'חופשה', target_amount: 5000, saved_amount: 1000 }], userId: 'u1', userName: 'יוסי', memories: [{ text: 'לא לוקחים הלוואות' }], today, screen: 'money' });
  assert.equal(s.userName, 'יוסי');
  assert.equal(s.screen, 'money');
  assert.equal(s.currentMonth, 'אוקטובר 2026');
  assert.equal(s.last6Months.length, 6);
  assert.deepEqual(s.last6Months[5], { month: 'אוקטובר 2026', income: 9000, expense: 300, balance: 8700 });
  assert.equal(s.categorySpendingHistory[0].category, 'אוכל');
  assert.equal(s.categorySpendingHistory[0].total6Months, 500);
  assert.deepEqual(s.categorySpendingHistory[0].subcategoriesThisMonth, [{ subcategory: 'סופר', amount: 300 }]);
  assert.deepEqual(s.personalCategoryBreakdown, [{ category: 'אוכל', amountThisMonth: 300 }]);
  assert.deepEqual(s.budgetsVsActual, [{ category: 'אוכל', monthlyBudget: 1000, spentSoFarThisMonth: 300 }]);
  assert.deepEqual(s.memories, ['לא לוקחים הלוואות']);
  assert.equal(s.savingsGoals[0].saved, 1000);
  assert.ok(s.comingMonths.months.length === 6);
  // No merchant names are sent.
  assert.doesNotMatch(JSON.stringify(s), /description/);
});

test('starters per screen, titles from the first question', () => {
  assert.equal(starters('assets').length, 3);
  assert.deepEqual(starters('unknown'), starters('home'));
  assert.equal(newTitle('כמה אני יכול להוציא היום?', 'home', new Date(2026, 9, 5)), 'כמה אני יכול להוציא היום? — 5.10');
  assert.match(newTitle('א'.repeat(60), 'home', new Date(2026, 9, 5)), /…/);
  assert.equal(newTitle('', 'money', new Date(2026, 9, 5)), 'ייעוץ כסף — 5.10');
});

test('old conversations: messages from the table, or from the legacy JSON column', () => {
  const rows = [
    { id: 'm1', role: 'advice', data: { headline: 'המצב יציב', tips: ['לחסוך 500'] }, author_id: 'u1' },
    { id: 'm2', role: 'user', text: 'מה עם הרכב?', author_id: 'u2' },
    { id: 'm3', role: 'ai', text: 'הרכב בסדר.\n@@הצעות: עוד?', author_id: 'u1' }
  ];
  assert.deepEqual(normalizeMessages(rows, [], 'u1'), [
    { id: 'm1', role: 'ai', text: 'המצב יציב\nמה לעשות: לחסוך 500', author_id: 'u1' },
    { id: 'm2', role: 'user', text: 'מה עם הרכב?', author_id: 'u2' },
    { id: 'm3', role: 'ai', text: 'הרכב בסדר.', author_id: 'u1' }
  ]);
  const legacy = [{ role: 'user', text: 'שלום' }, { role: 'ai', text: 'היי', pending: true }, { role: 'ai', text: 'תשובה' }];
  assert.deepEqual(normalizeMessages([], legacy, 'owner').map((m) => [m.role, m.text, m.author_id]), [['user', 'שלום', 'owner'], ['ai', 'תשובה', 'owner']]);
  assert.equal(adviceText(null), '');
});

test('history for the server: user turns carry the author name', () => {
  const h = historyFor([{ role: 'user', text: 'א', author_id: 'u2' }, { role: 'ai', text: 'ב' }], (id) => (id === 'u2' ? 'דני' : 'יוסי'));
  assert.deepEqual(h, [{ role: 'user', text: 'א', author: 'דני' }, { role: 'ai', text: 'ב', author: undefined }]);
});

test('server-sent events are parsed across chunk boundaries', () => {
  let out = parseSse('data: {"delta":"של"}\n\ndata: {"del');
  assert.deepEqual(out.events, [{ delta: 'של' }]);
  out = parseSse(out.rest + 'ta":"ום"}\n\n: keep-alive\n\ndata: {"done":true}\n\n');
  assert.deepEqual(out.events, [{ delta: 'ום' }, { done: true }]);
  assert.equal(out.rest, '');
});
