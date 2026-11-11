import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, guessProvider, sourcesOf, billingMonth, filesOf, statusOf, dueMonth, tracker, reminder, checkFile, issuerOf, companiesOf, otherSource, nameOf, howTo, missingCards, learnProvider } from '../public/app/src/domain/sources.js';

// Made-up household: one bank account, two cards.
const today = new Date(2026, 10, 12); // 12 Nov 2026
const accounts = [{ id: 'b1', name: 'עו״ש', bank_name: 'לאומי', salary_day: 10 }];
const cards = [{ id: 'c1', name: 'מקס של דנה', billing_day: 10, last4: '4821' }, { id: 'c2', name: 'כאל', billing_day: 2, last4: '1234' }, { id: 'c3', name: 'ישן', is_active: false }];

test('every provider has a logo, an https site and a Hebrew name; names are recognised', () => {
  assert.equal(PROVIDERS.filter((p) => p.kind === 'bank').length, 12);
  assert.equal(guessProvider('בנק פאג"י', 'bank'), 'pagi');
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
  // Asked for from the day after the charge, when the statement is surely there.
  assert.equal(statusOf(max, [], '2026-11', new Date(2026, 10, 10)), 'waiting', 'charged today: not yet');
  assert.equal(statusOf(max, [], '2026-11', new Date(2026, 10, 11)), 'missing', 'the day after');
  assert.equal(dueMonth(max, new Date(2026, 10, 10)), '2026-10');
  assert.equal(dueMonth({ kind: 'card', billingDay: 31 }, new Date(2026, 10, 30)), '2026-10', 'the 31st in a 30-day month: the 30th is the charge');
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

test('the company named first in a file is the one it is from', () => {
  assert.equal(issuerOf('מקס איט פיננסים בע"מ | פירוט עסקאות | כרטיס 4821'), 'max');
  assert.equal(issuerOf('בנק לאומי | תנועות בחשבון | ... | כאל חיוב חודשי'), 'leumi', 'the bank comes before the card company it shows');
  assert.equal(issuerOf('ישראכרט · פירוט חיובים'), 'isracard');
  assert.equal(issuerOf('תאריך | סכום | בית עסק'), null);
});

test('one statement a month for each card company, whatever the number of its cards', () => {
  const two = [{ id: 'm1', name: 'מקס', provider: 'max', billing_day: 10 }, { id: 'm2', name: 'מקס נוסף', provider: 'max', billing_day: 10 }, { id: 'l1', name: 'אשראי לאומי', provider: 'leumi', billing_day: 2 }];
  const g = companiesOf(sourcesOf({ accounts, cards: two }));
  assert.deepEqual(g.map((x) => [x.kind, x.provider, x.count]), [['bank', 'leumi', 1], ['card', 'max', 2], ['card', 'leumi', 1]]);
  assert.deepEqual(g[1].ids, ['m1', 'm2']);
  // A file chosen for either Max card fills the month for the company.
  const imports = [{ id: 'f1', source_kind: 'card', source_id: 'm2', date_from: '2026-10-11', date_to: '2026-11-05' }];
  const t = tracker({ accounts, cards: two, imports }, today);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[1].months[5].status, 'ok');
  assert.equal(t.tasks.filter((x) => x.source.provider === 'max').length, 0);
  // The card the bank issued is asked for apart from the account, by its own name.
  const bankCard = t.tasks.find((x) => x.source.kind === 'card' && x.source.provider === 'leumi');
  assert.match(bankCard.title, /אשראי לאומי/);
  assert.equal(nameOf(g[2]), 'אשראי לאומי');
  assert.match(howTo('card', 'leumi'), /באתר הבנק: כרטיסי אשראי/);
  assert.match(howTo('card', 'max'), /פירוט עסקאות/);
  assert.match(reminder({ ...g[1], billingDay: 10 }, '2026-11', 'missing', today).note, /2 כרטיסים, פירוט אחד לכולם/);
});

test('a file of another company or card: where to move it', () => {
  const list = sourcesOf({ accounts, cards });
  const [bank, max, cal] = list;
  // Its lines carry Cal's digits: move it to Cal.
  const byDigits = otherSource({ source: max, items: [{ card4: '1234' }, { card4: '1234' }], sources: list });
  assert.equal(byDigits.to.id, 'c2');
  assert.match(byDigits.text, /זה פירוט של כאל \(כרטיס 1234\), לא של מקס/);
  // It names Cal at the top: Cal.
  assert.equal(otherSource({ source: max, items: [], issuer: 'cal', sources: list }).to.id, 'c2');
  // It names Isracard, not in the list yet: offered to add it.
  const isra = otherSource({ source: max, items: [], issuer: 'isracard', sources: list });
  assert.equal(isra.to, null);
  assert.equal(isra.provider, 'isracard');
  // The right one, a bank name on a card, or nothing known: nothing to move.
  assert.equal(otherSource({ source: max, items: [{ card4: '4821' }], issuer: 'max', sources: list }), null);
  assert.equal(otherSource({ source: max, items: [], issuer: 'leumi', sources: list }), null);
  assert.equal(otherSource({ source: bank, items: [], issuer: null, sources: list }), null);
  assert.equal(otherSource({ source: bank, items: [], issuer: 'hapoalim', sources: list }).provider, 'hapoalim');
  // A card the bank issued may carry a card company's name: not a mistake.
  const own = { kind: 'card', id: 'x', provider: 'leumi' };
  assert.equal(otherSource({ source: own, items: [], issuer: 'max', sources: [...list, own] }), null);
  assert.equal(cal.provider, 'cal');
});

test('a company with several cards: a file with only some of them is noticed', () => {
  const two = sourcesOf({ cards: [{ id: 'm1', provider: 'max', last4: '4821' }, { id: 'm2', provider: 'max', last4: '5555' }, { id: 'k1', provider: 'cal' }] });
  assert.deepEqual(missingCards({ source: two[0], items: [{ card4: '4821' }, { card4: '4821' }], sources: two }), { found: 1, total: 2 });
  assert.equal(missingCards({ source: two[0], items: [{ card4: '4821' }, { card4: '5555' }], sources: two }), null);
  assert.equal(missingCards({ source: two[0], items: [{}], sources: two }), null, 'no digits in the file: nothing to say');
  assert.equal(missingCards({ source: two[2], items: [{ card4: '1' }], sources: two }), null, 'one card only');
});

test('a file with the digits of another card of the same company is fine', () => {
  const two = sourcesOf({ cards: [{ id: 'm1', provider: 'max', last4: '4821' }, { id: 'm2', provider: 'max', last4: '5555' }] });
  const items = [{ card4: '5555', include: true, date: '2026-10-20', amount: 10 }];
  assert.ok(!checkFile({ source: two[0], items, sources: two }).some((c) => c.ok === false));
  assert.ok(checkFile({ source: two[0], items: [{ card4: '9999', include: true, date: '2026-10-20', amount: 10 }], sources: two }).some((c) => c.ok === false));
});

test('cards and accounts saved before: known club cards by name, the rest from their next file', () => {
  const list = sourcesOf({ accounts: [{ id: 'a', name: 'נעמי' }, { id: 'p', name: 'עו״ש', bank_name: 'פאג"י' }], cards: [{ id: 'r', name: 'רמי לוי' }, { id: 'd', name: 'Dream Card' }, { id: 'x', name: 'הכרטיס של קובי' }] });
  assert.deepEqual(list.map((x) => x.provider), [null, 'pagi', 'isracard', 'max', null]);
  assert.ok(list.every((x) => x.saved === false));
  assert.equal(learnProvider({ source: list[0], issuer: 'leumi' }), 'leumi');
  assert.equal(learnProvider({ source: list[0], issuer: 'cal' }), null, 'a bank account is not a card company');
  assert.equal(learnProvider({ source: list[4], issuer: 'cal' }), 'cal');
  assert.equal(learnProvider({ source: list[4], issuer: 'hapoalim' }), 'hapoalim', 'a card the bank issued');
  assert.equal(learnProvider({ source: list[4], issuer: null }), null);
  assert.equal(learnProvider({ source: { ...list[4], saved: true, provider: 'max' }, issuer: 'cal' }), null, 'a chosen company is not changed');
});

test('the next statement: a card the day after its next charge, a bank account on the 1st of next month', async () => {
  const { nextDue, upcoming } = await import('../public/app/src/domain/sources.js');
  const card = { kind: 'card', billingDay: 10 };
  const iso = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  assert.equal(iso(nextDue(card, new Date(2026, 10, 5))), '2026-11-11', 'before the charge: this month\'s');
  assert.equal(iso(nextDue(card, new Date(2026, 10, 11))), '2026-12-11', 'after it: next month\'s');
  assert.equal(iso(nextDue({ kind: 'card', billingDay: 31 }, new Date(2026, 11, 31, 12))), '2027-1-1', 'on the charge day itself: from the next day, past the year\'s end');
  assert.equal(iso(nextDue({ kind: 'card', billingDay: 31 }, new Date(2027, 0, 5))), '2027-2-1', 'a short month: the day after its last day');
  assert.equal(iso(nextDue({ kind: 'bank' }, new Date(2026, 11, 20))), '2027-1-1');
  const list = upcoming([{ source: { id: 'b', kind: 'bank' } }, { source: { id: 'c', kind: 'card', billingDay: 2 } }], new Date(2026, 10, 11));
  assert.deepEqual(list.map((x) => x.source.id), ['b', 'c'], 'the nearest first');
});
