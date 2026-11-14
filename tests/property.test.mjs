import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPayment, monthsLeft, split, interestLeft, endDate, prepay, mortgageView, propertyView, monthlyCosts, rentCandidates, cleanProperty, RENT_EXEMPT_ABOUT } from '../public/app/src/domain/property.js';

const TODAY = new Date('2026-11-14T10:00:00Z');

test('the monthly payment of a Spitzer mortgage', () => {
  // ₪1,000,000 at 4.5% over 25 years: about ₪5,558 a month (a known figure).
  assert.ok(Math.abs(monthlyPayment(1000000, 4.5, 300) - 5558.34) < 1);
  assert.equal(monthlyPayment(120000, 0, 120), 1000, 'no interest: the balance in equal parts');
  assert.equal(monthlyPayment(0, 4, 100), 0);
});

test('how many months are left, and a payment that does not cover the interest', () => {
  const pay = monthlyPayment(1000000, 4.5, 300);
  assert.ok(Math.abs(monthsLeft(1000000, 4.5, pay) - 300) <= 1);
  assert.equal(monthsLeft(500000, 6, 2000), Infinity, '₪2,000 does not cover ₪2,500 of interest');
  assert.equal(monthsLeft(0, 5, 3000), 0);
});

test('this month: interest and the part that pays the loan down', () => {
  const s = split(600000, 5, 4000);
  assert.deepEqual(s, { interest: 2500, principal: 1500, payment: 4000 });
});

test('interest left and the end month', () => {
  const pay = monthlyPayment(240000, 6, 120);
  const total = interestLeft(240000, 6, pay);
  assert.ok(Math.abs(total - (pay * 120 - 240000)) < 20, 'all payments minus the balance');
  assert.equal(endDate(14, TODAY), '2028-01');
  assert.equal(endDate(Infinity, TODAY), null);
});

test('paying back a sum: shorter, or a lower payment, and the interest saved', () => {
  const pay = monthlyPayment(800000, 5, 240);
  const p = prepay(800000, 5, pay, 100000);
  assert.ok(p.shorter.monthsSaved > 30, 'about three years sooner');
  assert.ok(p.shorter.interestSaved > p.lower.interestSaved, 'shortening saves more interest than lowering the payment');
  assert.ok(Math.abs(p.lower.paymentDrop - (pay - monthlyPayment(700000, 5, 240))) < 2);
  assert.equal(prepay(50000, 5, 1000, 999999).sum, 50000, 'never more than what is left');
});

// Twenty made-up families, each with an apartment (rented out or their home)
// and a mortgage or none. Every view must make sense.
const FAMILIES = [
  { name: 'דירה להשקעה בבית שמש', rented: true, value: 1650000, rent: 5200, costs: { arnona: 380, vaad: 150, repairs: 200 }, mortgage: { balance: 820000, rate: 4.6, payment: 4700 } },
  { name: 'דירה בביתר', rented: true, value: 1450000, rent: 4600, costs: { arnona: 300, vaad: 120 }, mortgage: { balance: 900000, rate: 5.1, months: 300 } },
  { name: 'דירה במודיעין עילית', rented: true, value: 1550000, rent: 5000, costs: { vaad: 100, insurance: 60 }, mortgage: null },
  { name: 'דירה בבני ברק', rented: true, value: 2900000, rent: 7800, costs: { arnona: 520, vaad: 250, repairs: 300 }, mortgage: { balance: 1500000, rate: 4.2, payment: 9000 } },
  { name: 'הבית שלנו בירושלים', home: true, value: 2800000, rent: 0, costs: { arnona: 650, vaad: 300 }, mortgage: { balance: 1200000, rate: 4.8, payment: 7100 } },
  { name: 'דירה באלעד', rented: true, value: 1850000, rent: 5600, costs: { arnona: 400 }, mortgage: { balance: 1300000, rate: 5.4, payment: 6800 } },
  { name: 'דירה בצפת', rented: true, value: 980000, rent: 3300, costs: { arnona: 250, repairs: 150 }, mortgage: { balance: 300000, rate: 4.9, payment: 2500 } },
  { name: 'דירה בעפולה', rented: true, value: 1100000, rent: 3600, costs: {}, mortgage: { balance: 650000, rate: 5.0, payment: 3800 } },
  { name: 'דירת גן בגבעת זאב', rented: true, value: 2200000, rent: 6900, costs: { arnona: 450, vaad: 180, insurance: 90 }, mortgage: { balance: 1000000, rate: 3.9, months: 240 } },
  { name: 'דירה ברמת בית שמש', rented: true, value: 2100000, rent: 6100, costs: { arnona: 420, vaad: 160 }, mortgage: { balance: 0 } },
  { name: 'דירה קטנה באשדוד', rented: true, value: 1250000, rent: 4100, costs: { arnona: 280, vaad: 90 }, mortgage: { balance: 400000, rate: 6.2, payment: 3000 } },
  { name: 'דירה בנתיבות', rented: true, value: 950000, rent: 3200, costs: { arnona: 230 }, mortgage: { balance: 500000, rate: 5.5, payment: 3300 } },
  { name: 'הבית שלנו בקריית ספר', home: true, value: 1700000, costs: { arnona: 400, vaad: 130 }, mortgage: { balance: 600000, rate: 4.4, payment: 3900 } },
  { name: 'דירה בחיפה', rented: true, value: 1400000, rent: 4300, costs: { arnona: 350, vaad: 200, repairs: 250 }, mortgage: { balance: 700000, rate: 4.7, payment: 3500 } },
  { name: 'דירה בבאר שבע', rented: true, value: 1000000, rent: 3500, costs: { arnona: 260 }, mortgage: { balance: 760000, rate: 5.6, payment: 4800 } },
  { name: 'דירה בפתח תקווה', rented: true, value: 2300000, rent: 6000, costs: { arnona: 480, vaad: 220 }, mortgage: { balance: 1400000, rate: 4.3, payment: 8200 } },
  { name: 'דירה בטבריה', rented: false, value: 900000, rent: 0, costs: { arnona: 200, vaad: 80 }, mortgage: { balance: 200000, rate: 5.0, payment: 2100 } },
  { name: 'דירה בחריש', rented: true, value: 1300000, rent: 4000, costs: { arnona: 300 }, mortgage: { balance: 1000000, rate: 6.0, payment: 6400 } },
  { name: 'דירה בקריית גת', rented: true, value: 1050000, rent: 3700, costs: { arnona: 270, vaad: 100 }, mortgage: { balance: 520000, rate: 4.0, payment: 3100 } },
  { name: 'דירה בתל אביב', rented: true, value: 3600000, rent: 9500, costs: { arnona: 700, vaad: 350, repairs: 400 }, mortgage: { balance: 2000000, rate: 4.5, payment: 11000 } }
];

for (const [i, f] of FAMILIES.entries()) {
  test('family ' + (i + 1) + ' (' + f.name + '): the apartment and its mortgage make sense', () => {
    const v = propertyView(f, TODAY);
    const costs = monthlyCosts(f);
    // The month: rent minus the costs minus the mortgage payment.
    assert.equal(v.cashMonth, Math.round((((f.rent || 0) - costs - (v.mortgage ? v.mortgage.payment : 0))) * 100) / 100);
    assert.equal(v.cashYear, Math.round(v.cashMonth * 12 * 100) / 100);
    // What is theirs: the value minus what is left on the mortgage.
    assert.equal(v.equity, f.value - (v.mortgage ? v.mortgage.balance : 0));
    if (f.rent) {
      assert.ok(v.grossYield > 1.5 && v.grossYield < 6, 'a gross yield an Israeli apartment can have (' + v.grossYield + '%)');
      assert.ok(v.netYield <= v.grossYield);
    } else assert.equal(v.grossYield, 0);
    if (v.mortgage) {
      const m = v.mortgage;
      assert.ok(m.payment > 0);
      assert.ok(m.split.interest > 0 && m.split.principal >= 0);
      assert.equal(m.growing, false, 'every family here pays more than the interest');
      assert.equal(Math.round((m.split.interest + m.split.principal) * 100) / 100, Math.min(m.payment, Math.round((m.balance + m.split.interest) * 100) / 100));
      {
        assert.ok(m.months > 0 && m.months < 600, 'ends within 50 years');
        assert.match(m.ends, /^20\d\d-\d\d$/);
        assert.ok(m.interestLeft > 0);
        // The profit counts only the interest as a cost (the principal is theirs).
        assert.ok(v.profitMonth >= v.cashMonth);
      }
    } else assert.equal(!!(f.mortgage && f.mortgage.balance > 0), false);
    // Rent near or over the exemption ceiling is said, for checking only.
    if (f.rented && f.rent > RENT_EXEMPT_ABOUT) assert.equal(v.rentTax, 'over');
    if (!f.rented) assert.equal(v.rentTax, null);
  });
}

test('the rent coming in is found in the account, not the salary', () => {
  const tx = [];
  for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    tx.push({ type: 'income', amount: 5200, description: 'העברה מ כהן משה', tx_date: m + '-03' });
    tx.push({ type: 'income', amount: 14000, description: 'משכורת', tx_date: m + '-10' });
    tx.push({ type: 'income', amount: 300 + Math.random() * 50, description: 'ביט', tx_date: m + '-12' });
  }
  tx.push({ type: 'income', amount: 9000, description: 'העברה מ לוי', tx_date: '2026-10-05' });
  const c = rentCandidates(tx);
  assert.deepEqual(c.map((x) => [x.who, x.amount, x.months]), [['העברה מ כהן משה', 5200, 4]]);
});

test('what a family typed is kept as numbers only', () => {
  const p = cleanProperty({ name: '  דירה ', value: '1,650,000', rent: '5,200 ₪', costs: { arnona: '380', vaad: 'abc', evil: 9 }, mortgage: { balance: '820,000', rate: '4.6%', payment: '4700' } });
  assert.deepEqual(p, { name: 'דירה', city: null, home: false, rented: false, value: 1650000, rent: 5200, costs: { arnona: 380 }, mortgage: { balance: 820000, rate: 4.6, payment: 4700, months: null } });
  assert.equal(cleanProperty({ mortgage: { balance: '' } }).mortgage, null);
  assert.equal(cleanProperty({ mortgage: { balance: 100, rate: 80 } }).mortgage.rate, null, 'a rate that cannot be right');
});

test('a mortgage given only by its months gets its payment', () => {
  const m = mortgageView({ balance: 900000, rate: 5.1, months: 300 }, TODAY);
  assert.ok(Math.abs(m.payment - monthlyPayment(900000, 5.1, 300)) < 0.01);
  assert.ok(Math.abs(m.months - 300) <= 1);
});

test('a payment below the interest: the balance grows, and it is said', () => {
  const v = propertyView({ rented: true, value: 1100000, rent: 3600, mortgage: { balance: 650000, rate: 5, payment: 2600 } }, TODAY);
  assert.equal(v.mortgage.growing, true);
  assert.equal(v.mortgage.ends, null);
  assert.equal(v.mortgage.split.principal, 0);
  assert.equal(v.mortgage.interestLeft, Infinity);
});
