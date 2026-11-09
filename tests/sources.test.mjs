import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, guessProvider, sourcesOf, billingMonth, filesOf, statusOf, dueMonth, tracker, reminder, checkFile } from '../public/app/src/domain/sources.js';

// Made-up household: one bank account, two cards.
const today = new Date(2026, 10, 12); // 12 Nov 2026
const accounts = [{ id: 'b1', name: 'עו״ש', bank_name: 'לאומי', salary_day: 10 }];
const cards = [{ id: 'c1', name: 'מקס של דנה', billing_day: 10, last4: '4821' }, { id: 'c2', name: 'כאל', billing_day: 2, last4: '1234' }, { id: 'c3', name: 'ישן', is_active: false }];

test('every provider has a logo, an https site and a Hebrew name; names are recognised', () => {
  assert.equal(PROVIDERS.filter((p) => p.kind === 'bank').length, 11);
  assert.equal(PROVIDERS.filter((p) => p.kind === 'card').length, 5);
  for (const p of PROVIDERS) { assert.match(p.url, /^https:\/\//); assert.match(p.name, /[א-ת]/); assert.match(p.logo, /\.(svg|png)$/); }
  assert.equal(guessProvider('כרטיס מקס של דנה', 'card'), 'max');
  assert.equal(guessProvider('בנק לאומי', 'bank'), 'leumi');
  assert.equal(guessProvider('לאומי קארד', 'card'), 'max');
  assert.equal(guessProvider('משהו אחר'), null);
});

test('sources: every bank account and every active card, with its provider and dates', () => {
  const s = sourcesOf({ accounts, cards });
  assert.deepEqual(s.map((x) => [x.kind, x.id, x.provider]), [['bank', 'b1', 'leumi'], ['card', 'c1', 'max'], ['card', 'c2', 'cal']]);
  assert.equal(s[0].salaryDay, 10);
  assert.equal(s[1].billingDay, 10);
});

test('a card statement belongs to the month it was charged', () => {
  assert.equal(billingMonth('2026-10-08', 10), '2026-10');
  assert.equal(billingMonth('2026-10-09', 10), '2026-10');
  assert.equal(billingMonth('2026-10-12', 10), '2026-11');
  assert.equal(billingMonth('2026-12-20', 10), '2027-01');
  assert.equal(billingMonth('2026-10-01', 2), '2026-10');
});

test('a bank month is uploaded when most of its days are covered', () => {
  const bank = sourcesOf({ accounts })[0];
  assert.equal(statusOf(bank, [{ date_from: '2026-10-01', date_to: '2026-10-31' }], '2026-10', today), 'ok');
  assert.equal(statusOf(bank, [{ date_from: '2026-10-01', date_to: '2026-10-12' }], '2026-10', today), 'partial');
  assert.equal(statusOf(bank, [], '2026-10', today), 'missing');
  assert.equal(statusOf(bank, [], '2026-11', today), 'waiting', 'this month is not over');
});

test('a card month: uploaded, missing, or not charged yet', () => {
  const [, max, cal] = sourcesOf({ accounts, cards });
  assert.equal(statusOf(max, [{ date_from: '2026-10-10', date_to: '2026-11-08' }], '2026-11', today), 'ok');
  assert.equal(statusOf(max, [], '2026-11', today), 'missing', 'charged on the 10th, today is the 12th');
  assert.equal(statusOf(max, [], '2026-11', new Date(2026, 10, 5)), 'waiting');
  assert.equal(dueMonth(max, today), '2026-11');
  assert.equal(dueMonth(max, new Date(2026, 10, 5)), '2026-10');
  assert.equal(dueMonth(sourcesOf({ accounts })[0], today), '2026-10');
  assert.equal(statusOf(cal, [], '2026-10', today), 'missing');
});

test('older files are recognised by their lines: card lines by card, the rest to the only bank account', () => {
  const txs = [
    { import_id: 'i1', tx_date: '2026-10-02', card_id: 'c1', payment_method: 'credit' },
    { import_id: 'i1', tx_date: '2026-11-07', card_id: 'c1', payment_method: 'credit' },
    { import_id: 'i2', tx_date: '2026-10-01' }, { import_id: 'i2', tx_date: '2026-10-31' },
    { import_id: 'i3', tx_date: '2026-09-15', payment_method: 'credit' },
    { tx_date: '2026-10-05' }
  ];
  const [bank, max] = sourcesOf({ accounts, cards });
  assert.deepEqual(filesOf(max, { txs }).map((f) => f.id), ['i1']);
  assert.deepEqual(filesOf(bank, { txs, banks: 1 }).map((f) => f.id), ['i2']);
  assert.deepEqual(filesOf(bank, { txs, banks: 2 }).map((f) => f.id), [], 'two accounts: cannot tell which');
  assert.deepEqual(filesOf(max, { imports: [{ id: 'i9', source_id: 'c1', date_from: '2026-09-10', date_to: '2026-10-08' }], txs }).map((f) => f.id), ['i9', 'i1']);
});

test('the ring: what is due now and how much of it is uploaded, with a reminder for each missing one', () => {
  const imports = [
    { id: 'a', source_id: 'b1', date_from: '2026-10-01', date_to: '2026-10-31' },
    { id: 'b', source_id: 'c1', date_from: '2026-10-10', date_to: '2026-11-08' }
  ];
  const t = tracker({ accounts, cards, imports }, today);
  assert.deepEqual(t.months, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(t.ring, { done: 2, total: 3, pct: 67 });
  assert.equal(t.tasks.length, 1);
  assert.equal(t.tasks[0].source.id, 'c2');
  assert.equal(t.tasks[0].title, 'להעלות את פירוט כאל של נובמבר');
  assert.match(t.tasks[0].note, /החיוב ירד ב-2\.11/);
  assert.deepEqual(t.rows[0].months.map((m) => m.status), ['missing', 'missing', 'missing', 'missing', 'ok', 'waiting']);
  assert.equal(tracker({}, today).ring.pct, 0);
});

test('the bank reminder mentions the salary once it came in', () => {
  const bank = sourcesOf({ accounts })[0];
  assert.match(reminder(bank, '2026-10', 'missing', today).note, /המשכורת נכנסה ב-10/);
  assert.match(reminder(bank, '2026-10', 'missing', new Date(2026, 10, 3)).note, /הפירוט כבר זמין/);
  assert.equal(reminder(bank, '2026-10', 'missing', today).title, 'להעלות את פירוט העו״ש של אוקטובר (לאומי)');
});

test('a file is checked against the source it was chosen for', () => {
  const [bank, max] = sourcesOf({ accounts, cards });
  const items = [
    { date: '2026-10-12', amount: 100, type: 'expense', include: true, card4: '4821' },
    { date: '2026-11-07', amount: 50, type: 'expense', include: true, card4: '4821' },
    { date: '2026-10-20', amount: 30, type: 'expense', include: false, dupe: 'likely' }
  ];
  const ok = checkFile({ source: max, items, fromCard: true });
  assert.deepEqual(ok.map((c) => c.ok), [true, true, true, null]);
  assert.equal(ok[0].text, 'זה פירוט של מקס (כרטיס 4821)');
  assert.equal(ok[1].key, '2026-11');
  assert.equal(ok[2].text, '2 תנועות, סה״כ ₪150');
  const wrong = checkFile({ source: { ...max, last4: '9999' }, items, fromCard: true });
  assert.equal(wrong[1].ok, false);
  assert.equal(checkFile({ source: bank, items, fromCard: true })[0].ok, false);
  const charges = checkFile({ source: bank, items: [{ date: '2026-10-10', amount: 3000, include: false, cardCharge: true }, { date: '2026-10-11', amount: 10, include: true }] });
  assert.ok(charges.some((c) => /לא נספרים כאן/.test(c.text)));
  assert.deepEqual(checkFile({ items }), []);
});
