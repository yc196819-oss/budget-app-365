// Credit cards: what is shown for each card and how close it is to its
// limit. Pure: no DOM, no network.
//
//   card { id, name, last4, owner_user_id, billing_day, credit_limit,
//          bank_account_id, is_active }
//
// Only the last 4 digits are ever kept: never the full number, the expiry,
// the CVV or the PIN (those belong in the phone's password manager).

import { cardCycle } from './home.js';

export const activeCards = (cards = []) => cards.filter((c) => c.is_active !== false);

// '' (none) or exactly 4 digits.
export function cleanLast4(v) {
  const s = String(v ?? '').replace(/\D/g, '');
  return s.length === 4 ? s : s.length === 0 ? '' : null;
}

export const last4Valid = (v) => cleanLast4(v) !== null;

export function billingDayValid(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 28;
}

// "ויזה כאל ••••4821" (the digits are not repeated when the name has them).
// The dots and digits are isolated left-to-right, so a right-to-left line
// does not turn them into "4821••••".
export function cardLabel(card) {
  if (!card) return '';
  const name = card.name || 'כרטיס';
  return card.last4 && !name.includes(card.last4) ? name + ' \u2066••••' + card.last4 + '\u2069' : name;
}

// How much of the limit is used: the purchases not yet charged. Near from 80%.
export function usage(card, txs, today) {
  const cyc = cardCycle(card, txs, today);
  const limit = Number(card.credit_limit) || 0;
  if (!(limit > 0)) return { cyc, limit: null, used: cyc.pending, ratio: null, level: 'none', left: null };
  const ratio = cyc.pending / limit;
  return { cyc, limit, used: cyc.pending, ratio, left: limit - cyc.pending, level: ratio >= 1 ? 'over' : ratio >= 0.8 ? 'near' : 'ok' };
}

// The line under the card's name: whose it is and when it is charged.
export function cardSub(card, cyc, members = {}, me = null) {
  const parts = [];
  if (card.owner_user_id) parts.push(card.owner_user_id === me ? 'שלי' : 'של ' + (members[card.owner_user_id] || 'בן/בת הזוג'));
  parts.push('יורד ב-' + Number(cyc.next.slice(8, 10)) + '.' + Number(cyc.next.slice(5, 7)));
  return parts.join(' · ');
}

// The card a new expense starts with: the one used last (if it still
// exists), else the only card, else none.
export function defaultCard(cards, lastId) {
  const list = activeCards(cards);
  if (lastId && list.some((c) => c.id === lastId)) return lastId;
  return list.length === 1 ? list[0].id : null;
}

// The fields a transaction gets when paid by this card.
export function paidWith(card) {
  return card ? { card_id: card.id, account_id: card.bank_account_id || null, payment_method: 'credit' } : {};
}
