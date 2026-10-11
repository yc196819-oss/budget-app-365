// Deleting an account (required by Google Play, and the right thing to
// offer). A household the person is alone in is deleted with everything in
// it; a household shared with a partner stays theirs: the person only
// leaves it (the shared transactions, goals and decisions remain), and if
// they owned it, the partner becomes the owner.

// A household's rows, deleted before the household itself: the transactions
// and categories first (they point at the cards and accounts), then the rows
// the households(id) cascade does not reach. The household goes last, so a
// failed step leaves it in place and trying again finds everything.
const HOUSEHOLD_FIRST = ['transactions', 'category_budgets', 'categories', 'credit_cards', 'bank_accounts', 'push_subscriptions', 'user_settings', 'advisor_conversations', 'household_reset_codes'];
// The person's own rows in a household that stays.
const USER_ROWS = ['push_subscriptions', 'user_settings', 'advisor_conversations', 'household_reset_codes', 'checkin_feelings'];

// members: every membership row of the households the person is in.
// Returns { remove: [household ids], leave: [{ hid, newOwner | null }] }.
function plan(userId, members) {
  const hids = [...new Set(members.filter((m) => m.user_id === userId).map((m) => m.household_id))];
  const out = { remove: [], leave: [] };
  for (const hid of hids) {
    const here = members.filter((m) => m.household_id === hid);
    const others = here.filter((m) => m.user_id !== userId);
    if (!others.length) { out.remove.push(hid); continue; }
    const wasOwner = here.some((m) => m.user_id === userId && m.role === 'owner');
    const ownerLeft = others.some((m) => m.role === 'owner');
    out.leave.push({ hid, newOwner: wasOwner && !ownerLeft ? others[0].user_id : null });
  }
  return out;
}

const check = (r, what) => { if (r && r.error) throw new Error(what + ': ' + r.error.message); return r; };

// admin: a Supabase client with the service role. Deletes, in an order the
// foreign keys allow, then the login itself.
async function deleteAccount(admin, userId) {
  const mine = check(await admin.from('memberships').select('household_id').eq('user_id', userId), 'memberships');
  const hids = (mine.data || []).map((m) => m.household_id);
  const all = hids.length ? check(await admin.from('memberships').select('household_id,user_id,role').in('household_id', hids), 'members').data || [] : [];
  const p = plan(userId, all);
  for (const hid of p.remove) {
    for (const t of HOUSEHOLD_FIRST) check(await admin.from(t).delete().eq('household_id', hid), t);
    check(await admin.from('households').delete().eq('id', hid), 'household');
  }
  for (const { hid, newOwner } of p.leave) {
    check(await admin.from('memberships').delete().eq('household_id', hid).eq('user_id', userId), 'leave');
    if (newOwner) check(await admin.from('memberships').update({ role: 'owner' }).eq('household_id', hid).eq('user_id', newOwner), 'owner');
  }
  for (const t of USER_ROWS) check(await admin.from(t).delete().eq('user_id', userId), t);
  // Invites point at the login without a cascade.
  check(await admin.from('invites').delete().eq('created_by', userId).is('used_by', null), 'invites');
  check(await admin.from('invites').update({ created_by: null }).eq('created_by', userId), 'invites');
  check(await admin.from('invites').update({ used_by: null }).eq('used_by', userId), 'invites');
  check(await admin.auth.admin.deleteUser(userId), 'login');
  return p;
}

module.exports = { plan, deleteAccount, HOUSEHOLD_FIRST, USER_ROWS };
