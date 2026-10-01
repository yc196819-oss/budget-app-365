import { sb } from '../lib/supabase.js';
import { categoriesFor, initialBudgets, emergencyTarget, cleanCards, householdName, inviteLink, firstPicture } from '../domain/onboarding.js';

// Creates everything a new household needs, in the same tables and shapes as
// the current app. If the user already has a membership (two tabs, or the
// current app created one meanwhile), that one is used and nothing is created.
export async function createHousehold(user, answers) {
  const existing = await myMembership(user.id);
  if (existing) return existing;

  const { data: hh, error: hhErr } = await sb.from('households')
    .insert({ name: householdName(answers.name, answers.partner, answers.mode === 'together'), type: 'family' })
    .select().single();
  if (hhErr) throw hhErr;
  const { error: memErr } = await sb.from('memberships')
    .insert({ household_id: hh.id, user_id: user.id, display_name: String(answers.name || '').trim() || user.email.split('@')[0], role: 'owner' });
  if (memErr) {
    // Someone else won the race; drop this empty household and use theirs.
    await sb.from('households').delete().eq('id', hh.id);
    const again = await myMembership(user.id);
    if (again) return again;
    throw memErr;
  }
  const hid = hh.id;

  // Categories: roots, then their sub-categories, two requests in all.
  const cats = categoriesFor(answers.life || {});
  const { data: roots, error: rootErr } = await sb.from('categories')
    .insert(cats.map((c) => ({ household_id: hid, name: c.name, icon: c.icon, kind: c.kind })))
    .select('id,name');
  if (rootErr) throw rootErr;
  const idOf = new Map(roots.map((r) => [r.name, r.id]));
  const subs = cats.flatMap((c) => c.subs.map((s) => ({ household_id: hid, name: s, parent_id: idOf.get(c.name), kind: c.kind })));
  if (subs.length) {
    const { error } = await sb.from('categories').insert(subs);
    if (error) throw error;
  }

  // A main bank account and the cards (direct-debit cards have no billing day).
  const { data: acct, error: acctErr } = await sb.from('bank_accounts').insert({ household_id: hid, created_by: user.id, name: 'חשבון ראשי' }).select().single();
  if (acctErr) throw acctErr;
  const cards = cleanCards(answers.cards || []);
  if (cards.length) {
    const { error } = await sb.from('credit_cards').insert(cards.map((c) => ({
      household_id: hid, created_by: user.id, bank_account_id: acct.id, name: c.name, last4: c.last4 || null, billing_day: c.billing_day
    })));
    if (error) throw error;
  }

  // First budgets, expected income and an emergency fund goal.
  const budgets = initialBudgets(answers, roots.map((r) => r.name)).filter((b) => idOf.has(b.category));
  if (budgets.length) {
    const { error } = await sb.from('category_budgets').insert(budgets.map((b) => ({ household_id: hid, category_id: idOf.get(b.category), monthly_amount: b.amount, created_by: user.id })));
    if (error) throw error;
  }
  const pic = firstPicture(answers);
  if (pic.income) await sb.from('households').update({ income_expectations: [{ label: 'הכנסה חודשית נטו', amount: pic.income }] }).eq('id', hid);
  if (pic.saving > 0) {
    await sb.from('goals').insert({ household_id: hid, created_by: user.id, icon: '🛟', name: 'קרן חירום', target_amount: emergencyTarget(answers), saved_amount: 0, notes: 'הפרשה חודשית: ' + pic.saving });
  }
  return { household_id: hid, display_name: String(answers.name || '').trim(), role: 'owner' };
}

async function myMembership(userId) {
  const { data } = await sb.from('memberships').select('household_id,display_name,role').eq('user_id', userId).order('created_at', { ascending: true }).limit(1);
  return data && data[0] ? data[0] : null;
}

// ── invites ──
// The current app keeps a pending invite code under this key too.
export const PENDING_INVITE = 'pendingInvite';
export const DECLINED_INVITE = 'inviteDeclined';

export async function inviteInfo(code) {
  const { data, error } = await sb.rpc('get_invite_info', { p_code: code });
  if (error) throw error;
  return (data && data[0]) || { valid: false, reason: 'invalid' };
}

export async function acceptInvite(code) {
  const { error } = await sb.rpc('accept_household_invite', { p_code: code });
  if (error) {
    const key = ['INVITE_USED', 'INVITE_EXPIRED', 'INVITE_REVOKED', 'INVITE_INVALID', 'HOUSEHOLD_HAS_DATA'].find((k) => String(error.message || '').includes(k));
    const e = new Error(error.message || 'join failed');
    e.reason = key ? (key === 'HOUSEHOLD_HAS_DATA' ? key : key.replace('INVITE_', '').toLowerCase()) : null;
    throw e;
  }
}

// A one-time link for the partner, valid for 7 days (same as the current app).
export async function createInvite(hid, userId) {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await sb.from('invites').insert({ household_id: hid, code, created_by: userId, expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(), used: false });
  if (error) throw error;
  return inviteLink(location.origin, code);
}
