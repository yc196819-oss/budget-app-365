import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriesFor, firstPicture, initialBudgets, emergencyTarget, cleanCards, householdName, inviteLink, LIFE, DEFAULT_CATS } from '../public/app/src/domain/onboarding.js';

test('categories: the defaults plus what fits the household, expenses first', () => {
  const base = categoriesFor({});
  assert.equal(base.length, DEFAULT_CATS.length);
  const withCar = categoriesFor({ car: true, kids: true, parents: true });
  assert.ok(withCar.some((c) => c.name === 'רכב' && c.subs.includes('דלק')));
  assert.ok(withCar.some((c) => c.name === 'ילדים'));
  const firstIncome = withCar.findIndex((c) => c.kind === 'income');
  assert.ok(withCar.slice(firstIncome).every((c) => c.kind === 'income'));
  assert.ok(withCar.some((c) => c.name === 'עזרה מההורים' && c.kind === 'income'));
  assert.equal(new Set(categoriesFor(Object.fromEntries(LIFE.map((l) => [l.key, true]))).map((c) => c.name)).size, DEFAULT_CATS.length + LIFE.length);
});

test('the first picture: income − fixed − saving', () => {
  assert.deepEqual(firstPicture({ income: '15000', fixed: { rent: '5000', arnona: '600' }, saving: 1000 }), { income: 15000, fixedTotal: 5600, saving: 1000, left: 8400, perDay: 280, ok: true });
  const bad = firstPicture({ income: 8000, fixed: { rent: 7000 }, saving: 2000 });
  assert.equal(bad.left, -1000);
  assert.equal(bad.ok, false);
  assert.equal(bad.perDay, 0);
  assert.equal(firstPicture({}).income, 0);
});

test('initial budgets: fixed costs per category, the rest split over food and other', () => {
  const b = initialBudgets({ income: 15000, fixed: { rent: 5000, bills: 400, insurance: 300, kindergarten: 1800 }, saving: 1000 }, ['אוכל', 'בית ודיור', 'בריאות', 'שונות']);
  const by = Object.fromEntries(b.map((x) => [x.category, x.amount]));
  assert.equal(by['בית ודיור'], 5400);
  assert.equal(by['בריאות'], 300);
  // No "ילדים" category: the kindergarten goes to "שונות"; left = 15000-7500-1000 = 6500 → food 3900, other 2600.
  assert.equal(by['אוכל'], 3900);
  assert.equal(by['שונות'], 1800 + 2600);
  assert.deepEqual(initialBudgets({ income: 5000, fixed: { rent: 6000 } }, ['בית ודיור']), [{ category: 'בית ודיור', amount: 6000 }]);
});

test('emergency fund target: 3 months of spending, at least 10,000', () => {
  assert.equal(emergencyTarget({ income: 15000, fixed: { rent: 5000 }, saving: 1000 }), 42000);
  assert.equal(emergencyTarget({ income: 3000 }), 10000);
  assert.equal(emergencyTarget({}), 0);
});

test('cards, household name and invite link', () => {
  assert.deepEqual(cleanCards([{ name: ' ויזה ', last4: '12a34567', day: 15, type: 'credit' }, { name: '', day: 2 }, { name: 'דיירקט', type: 'direct', day: 10 }]), [
    { name: 'ויזה', last4: '1234', billing_day: 15, type: 'credit' },
    { name: 'דיירקט', last4: '', billing_day: null, type: 'direct' }
  ]);
  assert.equal(householdName('יוסי', 'דני', true), 'יוסי ודני');
  assert.equal(householdName('יוסי', 'דני', false), 'משק הבית של יוסי');
  assert.equal(householdName('', '', false), 'משק הבית שלנו');
  assert.equal(inviteLink('https://x.app', 'ab c'), 'https://x.app/app/?invite=ab%20c');
});
