import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  holidaysBetween, nextHoliday, previousOccurrence, lastHolidayExtra, holidayGoalName, defaultHolidayItems, quarterOf, checkinDue
} from '../public/app/src/domain/calendar.js';
import { baseline, forecast, verdict, cutIdeas } from '../public/app/src/domain/forecast.js';

let n = 0;
const tx = (o) => ({ id: 'x' + (++n), type: 'expense', amount: 100, spread: 'month', nature: 'variable', category_id: 'food', ...o });

test('holidays between dates, in order', () => {
  const h = holidaysBetween(new Date(2026, 8, 1), new Date(2026, 11, 31));
  assert.deepEqual(h.map((x) => [x.key, x.date]), [['roshHashana', '2026-09-12'], ['sukkot', '2026-09-26'], ['chanukah', '2026-12-05']]);
});

test('nextHoliday within three weeks, with days to go', () => {
  assert.deepEqual(nextHoliday(new Date(2026, 8, 20)), { key: 'sukkot', name: 'סוכות', date: '2026-09-26', inDays: 6, year: 2026 });
  assert.equal(nextHoliday(new Date(2026, 6, 1)), null);
  assert.equal(nextHoliday(new Date(2026, 8, 26)).inDays, 0);
});

test('previous occurrence and goal name', () => {
  assert.equal(previousOccurrence('sukkot', '2026-09-26'), '2025-10-07');
  assert.equal(previousOccurrence('sukkot', '2025-10-07'), null);
  assert.equal(holidayGoalName({ key: 'pesach', date: '2027-04-22' }), 'פסח 2027');
  assert.ok(defaultHolidayItems('sukkot').some((i) => i.name === 'ארבעת המינים' && i.on));
});

test('lastHolidayExtra: the holiday month last time minus the 6 months before it', () => {
  const txs = [];
  for (let m = 3; m <= 8; m++) txs.push(tx({ amount: 5000, tx_date: '2025-' + String(m + 1).padStart(2, '0') + '-10' }));
  txs.push(tx({ amount: 6730, tx_date: '2025-10-08' }));
  assert.equal(lastHolidayExtra('sukkot', '2026-09-26', txs), 1750);
  assert.equal(lastHolidayExtra('sukkot', '2026-09-26', txs.slice(4)), null);
});

test('quarters and when the check-in shows', () => {
  assert.deepEqual(quarterOf(new Date(2026, 9, 5)), { id: '2026-Q4', months: [{ y: 2026, m: 9 }, { y: 2026, m: 10 }, { y: 2026, m: 11 }] });
  assert.equal(checkinDue(new Date(2026, 9, 5), null), true);
  assert.equal(checkinDue(new Date(2026, 9, 5), '2026-Q4'), false);
  assert.equal(checkinDue(new Date(2026, 9, 25), null), false);
  assert.equal(checkinDue(new Date(2026, 10, 5), null), false);
});

// Today: 15 October 2026. Regular month: income 15,000, fixed 5,000, variable 8,000.
const TODAY = new Date(2026, 9, 15);
function history() {
  const txs = [];
  for (const m of ['07', '08', '09']) {
    txs.push(tx({ type: 'income', amount: 15000, nature: 'fixed', tx_date: '2026-' + m + '-10', category_id: 'sal' }));
    txs.push(tx({ amount: 5000, nature: 'fixed', tx_date: '2026-' + m + '-01', description: 'משכנתא', category_id: 'home' }));
    txs.push(tx({ amount: 8000, tx_date: '2026-' + m + '-12', description: 'סופר' }));
  }
  txs.push(tx({ type: 'income', amount: 15000, nature: 'fixed', tx_date: '2026-10-10', category_id: 'sal' }));
  txs.push(tx({ amount: 5000, nature: 'fixed', tx_date: '2026-10-01', description: 'משכנתא', category_id: 'home' }));
  txs.push(tx({ amount: 4000, tx_date: '2026-10-12', description: 'סופר' }));
  return txs;
}

test('baseline: the household\'s regular month', () => {
  assert.deepEqual(baseline(history(), TODAY), { income: 15000, fixed: 5000, variable: 8000 });
});

test('forecast: six months, balance carried month to month', () => {
  const fc = forecast({ txs: history(), today: TODAY, startBalance: 10000 });
  assert.equal(fc.months.length, 6);
  assert.equal(fc.months[0].name, 'אוקטובר 2026');
  assert.equal(fc.months[1].net, 2000);
  assert.equal(Math.round(fc.months[5].end - fc.months[1].end), 8000);
  assert.equal(fc.hasBalance, true);
  assert.equal(fc.regularNet, 2000);
  assert.equal(verdict(fc).tone, 'ok');
});

test('forecast adds yearly payments, installments, planned goals and unplanned holidays', () => {
  const txs = [...history(), tx({ amount: 3600, spread: 'year', tx_date: '2025-12-05', description: 'ביטוח רכב' })];
  const goals = [{ name: 'טיפול 30,000', target_amount: 2500, saved_amount: 500, target_date: '2026-11-15' }];
  const installments = [{ description: 'ספה', total_amount: 6000, payments_count: 3, first_payment: '2026-11-02' }];
  const fc = forecast({ txs, goals, installments, today: TODAY, startBalance: 0 });
  const nov = fc.months[1];
  assert.ok(nov.lines.some((l) => l.label === 'מתוכנן: טיפול 30,000' && l.amount === -2000));
  assert.ok(nov.lines.some((l) => l.label === 'תשלומים: ספה' && l.amount === -2000));
  const dec = fc.months[2];
  assert.ok(dec.lines.some((l) => l.label === 'תשלום שנתי: ביטוח רכב' && l.amount === -3600));
  assert.ok(dec.lines.some((l) => l.label === 'תשלומים: ספה'));
  assert.ok(fc.months[3].lines.some((l) => l.kind === 'installment'));
  assert.ok(!fc.months[4].lines.some((l) => l.kind === 'installment'));
});

test('a planned holiday is not counted twice', () => {
  const txs = history();
  for (let m = 4; m <= 9; m++) txs.push(tx({ amount: 100, tx_date: '2025-' + String(m).padStart(2, '0') + '-03' }));
  txs.push(tx({ amount: 3000, tx_date: '2025-12-16' }));
  for (let m = 6; m <= 11; m++) txs.push(tx({ amount: 1000, tx_date: '2025-' + String(m).padStart(2, '0') + '-20' }));
  const without = forecast({ txs, today: TODAY });
  assert.ok(without.months[2].lines.some((l) => l.kind === 'holiday' && l.holiday.key === 'chanukah'));
  const withPlan = forecast({ txs, today: TODAY, goals: [{ name: 'חנוכה 2026', target_amount: 1100, saved_amount: 0, target_date: '2026-12-05' }] });
  assert.ok(!withPlan.months[2].lines.some((l) => l.kind === 'holiday'));
  assert.ok(withPlan.months[2].lines.some((l) => l.label === 'מתוכנן: חנוכה 2026'));
});

test('what-if scenarios change the forecast without saving anything', () => {
  const fc = forecast({ txs: history(), today: TODAY, startBalance: 6000, scenarios: [{ kind: 'buy', amount: 10000, month: 1 }] });
  assert.ok(fc.months[0].end > 0);
  assert.ok(fc.months[1].end < 0);
  const v = verdict(fc);
  assert.equal(v.tone, 'danger');
  assert.match(v.title, /מנובמבר/);
  const better = forecast({ txs: history(), today: TODAY, startBalance: 0, scenarios: [{ kind: 'cut', amount: 500, month: 2 }, { kind: 'income', amount: -3000, month: 1 }] });
  assert.equal(Math.round(better.months[1].net), 2000 - 3000);
  assert.equal(Math.round(better.months[2].net), 2000 - 3000 + 500);
});

test('verdict without a known balance talks about monthly net', () => {
  const txs = history().map((t) => (t.description === 'סופר' ? { ...t, amount: 12000 } : t));
  const v = verdict(forecast({ txs, today: TODAY }));
  assert.equal(v.tone, 'danger');
  assert.match(v.title, /בחודש רגיל יוצא יותר/);
});

test('cutIdeas: over-budget variable categories first, then the biggest', () => {
  const cats = [{ id: 'food', name: 'אוכל', parent_id: null }, { id: 'fun', name: 'בילויים', parent_id: null }, { id: 'cafe', name: 'קפה', parent_id: 'fun' }];
  const txs = [
    ...['07', '08', '09'].map((m) => tx({ amount: 3000, tx_date: '2026-' + m + '-05' })),
    ...['07', '08', '09'].map((m) => tx({ amount: 900, tx_date: '2026-' + m + '-05', category_id: 'cafe' }))
  ];
  const ideas = cutIdeas(txs, cats, [{ category_id: 'fun', monthly_amount: 500 }], TODAY);
  assert.deepEqual(ideas.map((i) => [i.id, Math.round(i.avg), i.over]), [['fun', 900, true], ['food', 3000, false]]);
});
