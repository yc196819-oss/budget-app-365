// Money moved between the household's own bank accounts: out of one account
// and into another, the same amount, within a couple of days. Such a pair is
// neither an expense nor income. It is only ever marked after the household
// says so. Pure.
//
// A marked line keeps which way it went: type 'transfer_out' (was an
// expense) or 'transfer_in' (was income), so it can be undone exactly.

export const TRANSFER_OUT = 'transfer_out';
export const TRANSFER_IN = 'transfer_in';
export const isTransfer = (t) => !!t && (t.type === TRANSFER_OUT || t.type === TRANSFER_IN);
// The type a line had before it was marked (and gets back on undo).
export const typeBefore = (t) => (t.type === TRANSFER_IN ? 'income' : t.type === TRANSFER_OUT ? 'expense' : t.type || 'expense');
export const asTransfer = (t) => (typeBefore(t) === 'income' ? TRANSFER_IN : TRANSFER_OUT);

const DAY = 86400000;
const dayOf = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
const cents = (v) => Math.round(Math.abs(Number(v) || 0) * 100);
export const pairKey = (a, b) => [a.id, b.id].sort().join('|');

// The pairs to ask about: an outgoing line of one bank account and an
// incoming line of another, the same amount to the agora, at most `days`
// apart. Each line in one pair at most (the closest date wins). Lines on a
// card, lines already marked and pairs the household said "no" to are left
// out. Newest first.
export function transferPairs(txs, { days = 2, no = new Set() } = {}) {
  const lines = (txs || []).filter((t) => t && t.id && t.account_id && !t.card_id && !isTransfer(t) && cents(t.amount) > 0);
  const ins = new Map();
  for (const t of lines) if (t.type === 'income') { const k = cents(t.amount); ins.set(k, [...(ins.get(k) || []), t]); }
  const cands = [];
  for (const out of lines) {
    if (out.type === 'income') continue;
    for (const inn of ins.get(cents(out.amount)) || []) {
      if (inn.account_id === out.account_id) continue;
      const gap = Math.abs(dayOf(inn.tx_date) - dayOf(out.tx_date)) / DAY;
      if (gap > days || no.has(pairKey(out, inn))) continue;
      cands.push({ out, in: inn, gap });
    }
  }
  cands.sort((a, b) => a.gap - b.gap || String(b.out.tx_date).localeCompare(String(a.out.tx_date)));
  const used = new Set();
  const pairs = [];
  for (const c of cands) {
    if (used.has(c.out.id) || used.has(c.in.id)) continue;
    used.add(c.out.id); used.add(c.in.id);
    pairs.push({ key: pairKey(c.out, c.in), out: c.out, in: c.in, amount: Math.abs(Number(c.out.amount) || 0), gap: c.gap });
  }
  return pairs.sort((a, b) => String(b.out.tx_date).localeCompare(String(a.out.tx_date)));
}

// The lines to show and count, and the marked transfers apart.
export function splitTransfers(txs) {
  const keep = [], moved = [];
  for (const t of txs || []) (isTransfer(t) ? moved : keep).push(t);
  return { txs: keep, transfers: moved };
}

// A transfer's two sides, matched again for the list of marked transfers
// (same amount, the other direction, another account, closest date). A side
// whose partner is not found is shown alone.
export function markedPairs(transfers) {
  const outs = transfers.filter((t) => t.type === TRANSFER_OUT);
  const ins = transfers.filter((t) => t.type === TRANSFER_IN);
  const used = new Set();
  const out = [];
  for (const o of outs) {
    const best = ins.filter((i) => !used.has(i.id) && cents(i.amount) === cents(o.amount) && i.account_id !== o.account_id)
      .sort((a, b) => Math.abs(dayOf(a.tx_date) - dayOf(o.tx_date)) - Math.abs(dayOf(b.tx_date) - dayOf(o.tx_date)))[0];
    if (best) used.add(best.id);
    out.push({ out: o, in: best || null, amount: Math.abs(Number(o.amount) || 0) });
  }
  for (const i of ins) if (!used.has(i.id)) out.push({ out: null, in: i, amount: Math.abs(Number(i.amount) || 0) });
  return out.sort((a, b) => String((b.out || b.in).tx_date).localeCompare(String((a.out || a.in).tx_date)));
}
