// An apartment the family owns besides its home (or its home too), and the
// mortgage on it. Pure: the numbers a family needs to see, worked out from
// what it typed. Nothing here is tax or financial advice: the tax line points
// to a check, it does not decide.

const r2 = (n) => Math.round(n * 100) / 100;
// A number, or null when nothing is written (an empty field is not 0).
// "1.65 מיליון" and "800 אלף" (or "800K") as people write them.
const num = (v) => {
  let t = String(v == null ? '' : v).replace(/[,₪%\s]/g, '');
  if (!t) return null;
  let mult = 1;
  const word = /(מיליון|מליון|מ'|m)$|(אלף|אלפים|k)$/i.exec(t);
  if (word) { mult = word[1] ? 1e6 : 1e3; t = t.slice(0, word.index); }
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? n * mult : null;
};

// ── the mortgage (a "Spitzer" loan: the same payment every month) ──

// The monthly payment of a balance at a yearly rate over so many months.
export function monthlyPayment(balance, yearlyRatePct, months) {
  const b = num(balance), m = Math.round(num(months) || 0), i = (num(yearlyRatePct) || 0) / 100 / 12;
  if (!(b > 0) || !(m > 0)) return 0;
  if (i <= 0) return r2(b / m);
  return r2((b * i) / (1 - Math.pow(1 + i, -m)));
}

// How many months a payment takes to clear a balance (Infinity when the
// payment does not even cover the interest).
export function monthsLeft(balance, yearlyRatePct, payment) {
  const b = num(balance), p = num(payment), i = (num(yearlyRatePct) || 0) / 100 / 12;
  if (!(b > 0)) return 0;
  if (!(p > 0)) return Infinity;
  if (i <= 0) return Math.ceil(b / p);
  if (p <= b * i) return Infinity;
  return Math.ceil(-Math.log(1 - (b * i) / p) / Math.log(1 + i));
}

// This month's payment, split: how much goes to interest and how much
// actually pays the loan down.
export function split(balance, yearlyRatePct, payment) {
  const b = num(balance) || 0, p = num(payment) || 0, i = (num(yearlyRatePct) || 0) / 100 / 12;
  const interest = r2(b * i);
  const principal = r2(Math.max(0, Math.min(b, p - interest)));
  return { interest, principal, payment: r2(p) };
}

// All the interest still to pay, at this payment.
export function interestLeft(balance, yearlyRatePct, payment) {
  const m = monthsLeft(balance, yearlyRatePct, payment);
  if (!Number.isFinite(m)) return Infinity;
  let b = num(balance) || 0, total = 0;
  const i = (num(yearlyRatePct) || 0) / 100 / 12, p = num(payment) || 0;
  for (let k = 0; k < m && b > 0.005; k++) { const int = b * i; total += int; b = b + int - p; }
  return r2(total);
}

// The month the mortgage ends, from today.
export function endDate(months, today = new Date()) {
  if (!Number.isFinite(months)) return null;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + Math.max(0, months), 1));
  return d.toISOString().slice(0, 7);
}

// "What if we pay back a sum now?": the same payment ends it sooner, or the
// same end lowers the payment, and how much interest it saves either way.
export function prepay(balance, yearlyRatePct, payment, sum) {
  const b = num(balance) || 0, s = Math.min(b, Math.max(0, num(sum) || 0));
  const before = { months: monthsLeft(b, yearlyRatePct, payment), interest: interestLeft(b, yearlyRatePct, payment) };
  const left = b - s;
  const shorter = { months: monthsLeft(left, yearlyRatePct, payment), interest: interestLeft(left, yearlyRatePct, payment) };
  const lowerPayment = monthlyPayment(left, yearlyRatePct, before.months);
  const lower = { payment: lowerPayment, interest: interestLeft(left, yearlyRatePct, lowerPayment) };
  return {
    sum: r2(s),
    // The whole balance: the mortgage is closed.
    closes: s >= b - 0.5,
    shorter: { ...shorter, monthsSaved: Number.isFinite(before.months) ? before.months - shorter.months : null, interestSaved: r2(before.interest - shorter.interest) },
    lower: { ...lower, paymentDrop: r2((num(payment) || 0) - lowerPayment), interestSaved: r2(before.interest - lower.interest) }
  };
}

// The mortgage at a glance: what is left, until when, this month's split.
export function mortgageView(m, today = new Date()) {
  if (!m || !(num(m.balance) > 0)) return null;
  const rate = num(m.rate) || 0;
  // Without the rate, no end date or interest can be told (0% would be a nice lie).
  const noRate = !(rate > 0);
  const payment = num(m.payment) || (num(m.months) ? monthlyPayment(m.balance, rate, m.months) : 0);
  const months = monthsLeft(m.balance, rate, payment);
  return {
    balance: r2(num(m.balance)), rate, payment: r2(payment), months: noRate ? null : months, noRate,
    ends: noRate ? null : endDate(months, today), split: split(m.balance, rate, payment),
    interestLeft: noRate ? null : interestLeft(m.balance, rate, payment),
    // A payment that does not cover the interest: the balance grows.
    growing: !noRate && !Number.isFinite(months)
  };
}

// ── the apartment ──

// The monthly costs of owning it, besides the mortgage.
export const COSTS = [
  { key: 'arnona', label: 'ארנונה' }, { key: 'vaad', label: 'ועד בית' },
  { key: 'insurance', label: 'ביטוח מבנה' }, { key: 'repairs', label: 'תיקונים ותחזוקה' },
  { key: 'other', label: 'אחר' }
];
export const monthlyCosts = (p) => r2(COSTS.reduce((s, c) => s + (num(p && p.costs && p.costs[c.key]) || 0), 0));

// Residential rent below a yearly-updated ceiling is exempt from tax in
// Israel; above it there are tracks to choose. We only say when the rent is
// near or over it, as something to check, and never which track to take.
export const RENT_EXEMPT_ABOUT = 5654;

// An apartment's month and year: what it brings in, what it costs, what is
// left, its yield, and how much of it is the family's.
export function propertyView(p, today = new Date()) {
  const value = num(p && p.value) || 0;
  const rent = num(p && p.rent) || 0;
  const costs = monthlyCosts(p);
  const m = mortgageView(p && p.mortgage, today);
  const mortgagePay = m ? m.payment : 0;
  const cash = r2(rent - costs - mortgagePay);
  return {
    value, rent, costs, mortgage: m,
    // What is left in the pocket every month (the mortgage payment counted whole).
    cashMonth: cash, cashYear: r2(cash * 12),
    // What the mortgage really costs (its interest) and what it saves (its principal is the family's).
    profitMonth: r2(rent - costs - (m ? m.split.interest : 0)),
    equity: r2(value - (m ? m.balance : 0)),
    // Yearly rent against the value: gross, and after the costs (without the loan).
    grossYield: value > 0 ? r2(((rent * 12) / value) * 100) : null,
    netYield: value > 0 ? r2((((rent - costs) * 12) / value) * 100) : null,
    rentTax: !p || !p.rented ? null : rent > RENT_EXEMPT_ABOUT ? 'over' : rent > RENT_EXEMPT_ABOUT * 0.9 ? 'near' : null
  };
}

// Income lines that look like the rent coming in: the same payer and about
// the same amount, month after month (at least 3 of the last 4 months).
//   transactions: [{ type, amount, description, tx_date }]
export function rentCandidates(transactions, { months = 4, minAmount = 1000 } = {}) {
  const groups = new Map();
  for (const t of transactions || []) {
    if (t.type !== 'income' || !(num(t.amount) >= minAmount)) continue;
    const who = String(t.description || '').replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    if (!who || /משכורת|שכר עבודה|ביטוח לאומי|קצבה|החזר מס|העברה מחשבון/.test(who)) continue;
    const g = groups.get(who) || { who, months: new Set(), amounts: [] };
    g.months.add(String(t.tx_date).slice(0, 7));
    g.amounts.push(num(t.amount));
    groups.set(who, g);
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.months.size < Math.min(3, months)) continue;
    const sorted = [...g.amounts].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    if (sorted.some((a) => Math.abs(a - mid) > mid * 0.15)) continue;
    out.push({ who: g.who, amount: r2(mid), months: g.months.size });
  }
  return out.sort((a, b) => b.months - a.months || b.amount - a.amount);
}

// What a family typed, made safe to keep: numbers as numbers, nothing else.
export function cleanProperty(input) {
  const n = (v) => { const x = num(v); return x != null && x >= 0 && x < 1e9 ? x : null; };
  const costs = {};
  for (const c of COSTS) { const v = n(input && input.costs && input.costs[c.key]); if (v) costs[c.key] = v; }
  const mm = (input && input.mortgage) || {};
  let rate = num(mm.rate);
  // "0.045" is 4.5% written as a fraction (no mortgage is at 0.05%).
  if (rate > 0 && rate < 0.2) rate = Math.round(rate * 10000) / 100;
  const mortgage = n(mm.balance) ? { balance: n(mm.balance), rate: rate != null && rate >= 0 && rate < 30 ? rate : null, payment: n(mm.payment), months: n(mm.months) } : null;
  return {
    name: String((input && input.name) || '').trim().slice(0, 60) || 'הדירה',
    city: String((input && input.city) || '').trim().slice(0, 60) || null,
    home: !!(input && input.home),
    rented: !!(input && input.rented),
    value: n(input && input.value),
    rent: n(input && input.rent),
    costs,
    mortgage
  };
}

// An apartment run through its own bank account: what really came in and
// went out there, a month on average over the last full months (this month
// is not over yet). The mortgage payment, when it is paid from there, is
// apart: it is already counted from the mortgage.
//   transactions: [{ type, amount, description, tx_date, account_id }]
const MORTGAGE_LINE = /משכנתא|משכנתה|הלוואה לדיור|מסלול הלוואה|טפחות.*הלוואה/;
export function accountFlows(transactions, accountId, { months = 3, today = new Date() } = {}) {
  if (!accountId) return null;
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 7);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, 1)).toISOString().slice(0, 7);
  let income = 0, expense = 0, mortgage = 0;
  const seen = new Set();
  for (const t of transactions || []) {
    if (t.account_id !== accountId) continue;
    const ym = String(t.tx_date || '').slice(0, 7);
    if (!(ym >= start && ym < end)) continue;
    const a = Math.abs(num(t.amount) || 0);
    seen.add(ym);
    if (t.type === 'income') income += a;
    else if (MORTGAGE_LINE.test(String(t.description || ''))) mortgage += a;
    else expense += a;
  }
  if (!seen.size) return { months: 0, income: 0, expense: 0, mortgage: 0 };
  return { months: seen.size, income: r2(income / months), expense: r2(expense / months), mortgage: r2(mortgage / months) };
}

// The apartment as its account shows it: the rent and the costs from there
// (when the account has lines), the rest as typed.
export function withAccount(p, flows) {
  if (!p || !flows || !flows.months) return p;
  return { ...p, rent: flows.income, costs: { other: flows.expense } };
}
