import { sb } from '../lib/supabase.js';
import { track, reportError } from '../lib/telemetry.js';
import { addMissingCategories } from './onboarding.js';
import { showToast } from '../lib/toast.js';
import { isoDate } from '../domain/money.js';
import { REPAIRED } from '../domain/repair.js';
import { readCache, writeCache } from '../lib/storage.js';
import { forgetRules } from './rules.js';

// Household data for the new app: transactions of the last ~2 years (enough
// for 12 months plus expenses spread over a year), categories, monthly
// budgets and member names. Loaded once per household and shared by all
// screens through useHousehold().

const PAGE = 1000;
const MONTHS_BACK = 23;
const DELETE_DELAY_MS = 5000;

const state = { hid: null, userId: null, status: 'idle', error: null, txs: [], categories: [], budgets: [], members: {}, genders: {}, accounts: [], cards: [], goals: [], installments: [], loans: [], investments: [], income: [], hidden: new Set(), refreshing: false };
const listeners = new Set();
const pendingDeletes = new Map();

// What is kept on the device for an instant start (not the pending deletes).
const CACHED = ['txs', 'categories', 'budgets', 'members', 'genders', 'accounts', 'cards', 'goals', 'installments', 'loans', 'investments', 'income'];
let saveTimer = null;
function emit() {
  listeners.forEach((fn) => fn());
  if (state.status === 'ready' && state.hid) {
    clearTimeout(saveTimer);
    const hid = state.hid;
    saveTimer = setTimeout(() => { if (state.hid === hid && state.status === 'ready') writeCache('household:' + hid, Object.fromEntries(CACHED.map((k) => [k, state[k]]))); }, 800);
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function snapshot() {
  return {
    hid: state.hid,
    userId: state.userId,
    status: state.status,
    error: state.error,
    refreshing: state.refreshing,
    txs: state.txs.filter((t) => !state.hidden.has(t.id)),
    categories: state.categories,
    budgets: state.budgets,
    members: state.members,
    genders: state.genders,
    accounts: state.accounts,
    cards: state.cards,
    goals: state.goals,
    installments: state.installments,
    loans: state.loans,
    investments: state.investments,
    income: state.income,
    people: state.people || null,
    dupeOk: state.dupeOk || []
  };
}

async function fetchAllTransactions(hid, since) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('transactions')
      .select('*')
      .eq('household_id', hid)
      .gte('tx_date', since)
      .order('tx_date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

export async function load(hid, userId, { force = false } = {}) {
  if (!hid) return;
  if (!force && state.hid === hid && (state.status === 'ready' || state.status === 'loading')) return;
  if (state.refreshing && state.hid === hid) return;
  const hadData = state.hid === hid && state.status === 'ready';
  // Open at once with the last data seen on this device, then refresh.
  const cached = hadData ? null : readCache('household:' + hid);
  if (cached) Object.assign(state, { hid, userId, ...cached.data, status: 'ready', error: null, hidden: new Set(), refreshing: true });
  else Object.assign(state, { hid, userId, status: hadData ? 'ready' : 'loading', error: null, refreshing: true });
  emit();
  try {
    const now = new Date();
    const since = isoDate(new Date(now.getFullYear(), now.getMonth() - MONTHS_BACK, 1));
    const [txs, cats, budgets, mems, accounts, cards, goals, installments, loans, investments, household, people, dupeOk] = await Promise.all([
      fetchAllTransactions(hid, since),
      sb.from('categories').select('id,name,icon,kind,parent_id').eq('household_id', hid),
      sb.from('category_budgets').select('category_id,monthly_amount').eq('household_id', hid),
      sb.from('memberships').select('user_id,display_name,gender').eq('household_id', hid),
      sb.from('bank_accounts').select('id,name,bank_name,provider,salary_day,balance,balance_updated_at').eq('household_id', hid),
      sb.from('credit_cards').select('id,name,provider,bank_account_id,billing_day,last4,owner_user_id,credit_limit,is_active').eq('household_id', hid),
      sb.from('goals').select('*').eq('household_id', hid),
      sb.from('installments').select('*').eq('household_id', hid),
      sb.from('loans').select('*').eq('household_id', hid),
      sb.from('investments').select('*').eq('household_id', hid),
      sb.from('households').select('income_expectations').eq('id', hid).maybeSingle(),
      // Its own request: until the column exists everywhere, a failure here changes nothing else.
      sb.from('households').select('people').eq('id', hid).maybeSingle(),
      sb.from('dupe_ok').select('pair').eq('household_id', hid)
    ]);
    for (const r of [cats, budgets, mems]) if (r.error) throw r.error;
    // Accounts, cards, goals, installments, loans and investments add to home,
    // plans and assets: if one of them fails, those screens still work without it.
    if (state.hid !== hid) return;
    // No categories at all (an early version made the household without
    // them): add the usual ones, or nothing can be sorted.
    if (!(cats.data || []).length) {
      try { const made = await addMissingCategories(hid); if (made) cats.data = made; } catch (err) { reportError(err, 'categories:missing'); }
    }
    Object.assign(state, {
      status: 'ready',
      refreshing: false,
      txs,
      categories: cats.data || [],
      budgets: budgets.data || [],
      members: Object.fromEntries((mems.data || []).map((m) => [m.user_id, m.display_name || ''])),
      genders: Object.fromEntries((mems.data || []).map((m) => [m.user_id, m.gender || null])),
      accounts: accounts.error ? [] : accounts.data || [],
      cards: cards.error ? [] : (cards.data || []).filter((c) => c.is_active !== false),
      goals: goals.error ? [] : goals.data || [],
      installments: installments.error ? [] : installments.data || [],
      loans: loans.error ? [] : loans.data || [],
      investments: investments.error ? [] : investments.data || [],
      income: !household.error && household.data && Array.isArray(household.data.income_expectations) ? household.data.income_expectations : [],
      people: !people.error && people.data && Number(people.data.people) > 0 ? Number(people.data.people) : null,
      dupeOk: dupeOk.error ? [] : (dupeOk.data || []).map((r) => r.pair),
      hidden: new Set()
    });
  } catch (err) {
    if (state.hid !== hid) return;
    // With data already on screen, keep it and say so; otherwise show the error.
    if (state.status === 'ready') { state.refreshing = false; showToast('לא הצלחנו לרענן את הנתונים. מוצגים הנתונים האחרונים.'); }
    else Object.assign(state, { status: 'error', error: err.message || String(err), refreshing: false });
  }
  emit();
}

export async function addTransaction({ type = 'expense', amount, description, category_id = null, subcategory_id = null, tx_date, paid = {} }) {
  track('tx_add');
  const row = {
    household_id: state.hid,
    created_by: state.userId,
    type,
    amount,
    description: description || '(ללא תיאור)',
    tx_date: tx_date || isoDate(new Date()),
    category_id,
    subcategory_id,
    nature: 'variable',
    spread: 'month',
    source: 'manual',
    // The card it was paid with (card_id, account_id, payment_method), if chosen.
    ...(type === 'income' ? {} : paid)
  };
  const { data, error } = await sb.from('transactions').insert(row).select().single();
  if (error) throw error;
  state.txs = [data, ...state.txs];
  emit();
  return data;
}

// The bank balance is typed in by hand and shared by the household.
export async function setBalance(accountId, balance) {
  const patch = { balance, balance_updated_at: new Date().toISOString(), balance_updated_by: state.userId };
  const { error } = await sb.from('bank_accounts').update(patch).eq('id', accountId).eq('household_id', state.hid);
  if (error) throw error;
  state.accounts = state.accounts.map((a) => (a.id === accountId ? { ...a, ...patch } : a));
  emit();
}

// Monthly budget of a category; 0 removes it.
export async function setBudget(categoryId, amount) {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (value === 0) {
    const { error } = await sb.from('category_budgets').delete().eq('household_id', state.hid).eq('category_id', categoryId);
    if (error) throw error;
    state.budgets = state.budgets.filter((b) => b.category_id !== categoryId);
  } else {
    const row = { household_id: state.hid, category_id: categoryId, monthly_amount: value, created_by: state.userId };
    const { error } = await sb.from('category_budgets').upsert(row, { onConflict: 'household_id,category_id' });
    if (error) throw error;
    state.budgets = state.budgets.some((b) => b.category_id === categoryId)
      ? state.budgets.map((b) => (b.category_id === categoryId ? { ...b, monthly_amount: value } : b))
      : [...state.budgets, { category_id: categoryId, monthly_amount: value }];
  }
  emit();
}

// Goals double as plans: a holiday or a planned expense is a goal with a
// target date and a list of items, the same shape the current app uses.
export async function saveGoal(goal) {
  const { id, ...fields } = goal;
  try { return await writeGoal(id, fields); } catch (err) {
    // Before supabase_goal_trip_plan.sql the column is not there: the goal
    // is saved without the trip plan.
    if (!('trip_plan' in fields) || !/trip_plan/.test(String(err && err.message))) throw err;
    const { trip_plan: _tp, ...rest } = fields;
    return writeGoal(id, rest);
  }
}

async function writeGoal(id, fields) {
  const q = id
    ? sb.from('goals').update(fields).eq('id', id).eq('household_id', state.hid)
    : sb.from('goals').insert({ saved_amount: 0, ...fields, household_id: state.hid, created_by: state.userId });
  const { data, error } = await q.select().single();
  if (error) throw error;
  state.goals = id ? state.goals.map((g) => (g.id === id ? data : g)) : [...state.goals, data];
  emit();
  return data;
}

export async function deleteGoal(id) {
  const { error } = await sb.from('goals').delete().eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.goals = state.goals.filter((g) => g.id !== id);
  emit();
}

// Insert or update a row of a household table (accounts, investments, loans)
// and keep the store in step.
const LISTS = { bank_accounts: 'accounts', credit_cards: 'cards', investments: 'investments', loans: 'loans', installments: 'installments' };
export async function saveRow(table, row) {
  const key = LISTS[table];
  if (!key) throw new Error('unknown table ' + table);
  const { id, ...fields } = row;
  const q = id
    ? sb.from(table).update(fields).eq('id', id).eq('household_id', state.hid)
    : sb.from(table).insert({ ...fields, household_id: state.hid, created_by: state.userId });
  const { data, error } = await q.select().single();
  if (error) throw error;
  state[key] = id ? state[key].map((r) => (r.id === id ? data : r)) : [...state[key], data];
  emit();
  return data;
}

// A category of the household's own: top level (with its kind) or under a
// parent. Shows everywhere at once.
export async function addCategory({ name, kind = 'expense', parentId = null, icon = null }) {
  const parent = parentId ? state.categories.find((c) => c.id === parentId) : null;
  const row = { household_id: state.hid, name, icon: icon || null, parent_id: parentId || null, kind: parent ? parent.kind || 'expense' : kind };
  const { data, error } = await sb.from('categories').insert(row).select('id,name,icon,kind,parent_id').single();
  if (error) throw error;
  state.categories = [...state.categories, data];
  emit();
  return data;
}
export async function renameCategory(id, { name, icon }) {
  const patch = { name, ...(icon !== undefined ? { icon: icon || null } : {}) };
  const { data, error } = await sb.from('categories').update(patch).eq('id', id).eq('household_id', state.hid).select('id,name,icon,kind,parent_id').single();
  if (error) throw error;
  state.categories = state.categories.map((c) => (c.id === id ? data : c));
  emit();
  return data;
}

// How many transactions a category holds, in the whole history (not only
// the months loaded on the device): a sub-category by its own column.
export async function categoryTxCount(id) {
  const cat = state.categories.find((c) => c.id === id);
  const col = cat && cat.parent_id ? 'subcategory_id' : 'category_id';
  const { count, error } = await sb.from('transactions').select('id', { count: 'exact', head: true }).eq('household_id', state.hid).eq(col, id);
  if (error) throw error;
  return count || 0;
}

// Deletes a category. A sub-category's transactions stay in its parent
// (the database clears the sub-category). A top-level category first moves
// everything that points at it to `targetId`: its transactions (sub-category
// cleared), its rules, shared decisions and installments, and its monthly
// budget (added to the target's). Then the category and its sub-categories go.
export async function deleteCategory(id, targetId = null) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) throw new Error('unknown category');
  const subs = state.categories.filter((c) => c.parent_id === id).map((c) => c.id);
  const gone = new Set([id, ...subs]);
  if (!cat.parent_id && targetId) {
    const target = state.categories.find((c) => c.id === targetId);
    if (!target || target.parent_id || gone.has(targetId) || (target.kind || 'expense') !== (cat.kind || 'expense')) throw new Error('bad target');
    const hid = state.hid;
    const move = async (table, patch) => {
      const { error } = await sb.from(table).update(patch).eq('household_id', hid).eq('category_id', id);
      if (error) throw error;
    };
    await move('transactions', { category_id: targetId, subcategory_id: null });
    await move('category_rules', { category_id: targetId, subcategory_id: null });
    await move('shared_decisions', { category_id: targetId });
    await move('installments', { category_id: targetId });
    const mine = state.budgets.find((b) => b.category_id === id);
    if (mine && Number(mine.monthly_amount) > 0) {
      const theirs = state.budgets.find((b) => b.category_id === targetId);
      await setBudget(targetId, (theirs ? Number(theirs.monthly_amount) || 0 : 0) + Number(mine.monthly_amount));
    }
    state.txs = state.txs.map((t) => (t.category_id === id ? { ...t, category_id: targetId, subcategory_id: null } : t));
    state.installments = state.installments.map((r) => (r.category_id === id ? { ...r, category_id: targetId } : r));
  }
  const { error } = await sb.from('categories').delete().eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.categories = state.categories.filter((c) => !gone.has(c.id));
  state.budgets = state.budgets.filter((b) => !gone.has(b.category_id));
  state.txs = state.txs.map((t) => (gone.has(t.category_id) ? { ...t, category_id: null, subcategory_id: null } : gone.has(t.subcategory_id) ? { ...t, subcategory_id: null } : t));
  forgetRules();
  track('category_delete');
  emit();
}

// The monthly net income the household expects (households.income_expectations,
// the lines the previous app edits). The approved total becomes one line,
// keeping its name when there was a single line.
// One line of the expected income (by its label): set it, add it, or with
// 0 remove it. The other lines (the partner's salary) stay as they are.
export async function setIncomeLine(label, amount) {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  const name = String(label || '').trim() || 'הכנסה חודשית נטו';
  const rest = state.income.filter((l) => String(l && l.label || '').trim() !== name);
  const next = value > 0 ? [...rest, { label: name, amount: value }] : rest;
  const { error } = await sb.from('households').update({ income_expectations: next }).eq('id', state.hid);
  if (error) throw error;
  state.income = next;
  emit();
}

// Two lines that look like a double charge but are two real purchases: kept
// for the whole household, so no member is asked about them again.
export async function keepBoth(pair) {
  state.dupeOk = [...new Set([...(state.dupeOk || []), pair])];
  emit();
  const { error } = await sb.from('dupe_ok').upsert({ household_id: state.hid, pair }, { onConflict: 'household_id,pair' });
  if (error) throw error;
}

// How many people live at home (for "per person" amounts).
export async function setPeople(n) {
  const value = Math.max(1, Math.min(20, Math.round(Number(n) || 0)));
  const { error } = await sb.from('households').update({ people: value }).eq('id', state.hid);
  if (error) throw error;
  state.people = value;
  emit();
}

export async function setIncome(amount) {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  const label = state.income.length === 1 && state.income[0] && state.income[0].label ? state.income[0].label : 'הכנסה חודשית נטו';
  const next = [{ label, amount: value }];
  const { error } = await sb.from('households').update({ income_expectations: next }).eq('id', state.hid);
  if (error) throw error;
  state.income = next;
  emit();
}

export async function deleteRow(table, id) {
  const key = LISTS[table];
  if (!key) throw new Error('unknown table ' + table);
  const { error } = await sb.from(table).delete().eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state[key] = state[key].filter((r) => r.id !== id);
  emit();
}

// A card is removed by archiving it: its past purchases keep pointing at it.
export async function archiveCard(id) {
  const { error } = await sb.from('credit_cards').update({ is_active: false }).eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.cards = state.cards.filter((c) => c.id !== id);
  emit();
}

// Saves the lines of an imported statement, under one "import" (the file),
// so a wrong file can be removed whole later. Returns the new rows.
export async function addImported(rows, { fileName = null, kind = null, source = null } = {}) {
  const added = [];
  // A bank file's lines belong to its account.
  if (source && source.kind === 'bank') rows = rows.map((r) => (r.account_id ? r : { ...r, account_id: source.id }));
  const importId = await startImport(rows, { fileName, kind, source });
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, household_id: state.hid, created_by: state.userId, ...(importId ? { import_id: importId } : {}) }));
    const { data, error } = await sb.from('transactions').insert(chunk).select();
    if (error) {
      // Keep the store in step with what did get saved before the failure.
      if (added.length) { state.txs = [...added, ...state.txs]; emit(); }
      const err = new Error(error.message || 'insert failed');
      err.saved = added;
      throw err;
    }
    added.push(...data);
  }
  state.txs = [...added, ...state.txs];
  emit();
  return added;
}

async function startImport(rows, { fileName, kind, source }) {
  const dates = rows.map((r) => r.tx_date).filter(Boolean).sort();
  const { data, error } = await sb.from('imports').insert({
    household_id: state.hid, created_by: state.userId, file_name: fileName ? String(fileName).slice(0, 120) : null,
    kind: kind ? String(kind).slice(0, 10) : null, rows: rows.length, date_from: dates[0] || null, date_to: dates[dates.length - 1] || null,
    ...(source ? { source_kind: source.kind, source_id: source.id } : {})
  }).select('id').single();
  // Without the table (an older database) the lines are saved as before.
  return error || !data ? null : data.id;
}

// Which account or card each uploaded file belongs to, and the dates it
// covers: for "complete the picture" (not the removed files).
export async function listSourceFiles() {
  const { data, error } = await sb.from('imports').select('id,source_kind,source_id,date_from,date_to,created_at')
    .eq('household_id', state.hid).is('removed_at', null).order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return data || [];
}

// The files uploaded to this household, newest first (not the removed ones).
export async function listImports() {
  const { data, error } = await sb.from('imports').select('id,file_name,title,kind,rows,date_from,date_to,created_at,created_by')
    .eq('household_id', state.hid).is('removed_at', null).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}

// A name of the person's own for an uploaded file ("the October card"); the
// original file name stays as it was. An empty name goes back to the original.
export async function renameImport(id, title) {
  const t = String(title || '').trim().slice(0, 80) || null;
  const { error } = await sb.from('imports').update({ title: t }).eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  return t;
}

// Removes every line that came from one file (into the recycle bin, so it
// can be brought back for 30 days) and marks the file removed.
export async function removeImport(id) {
  const { error } = await sb.from('transactions').delete().eq('household_id', state.hid).eq('import_id', id);
  if (error) throw error;
  await sb.from('imports').update({ removed_at: new Date().toISOString() }).eq('id', id).eq('household_id', state.hid);
  state.txs = state.txs.filter((t) => t.import_id !== id);
  emit();
}

// Undo of an import.
export async function removeMany(ids) {
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const { error } = await sb.from('transactions').delete().in('id', part).eq('household_id', state.hid);
    if (error) throw error;
  }
  const gone = new Set(ids);
  state.txs = state.txs.filter((t) => !gone.has(t.id));
  emit();
}

// The advisor's fix for a mistake in an upload (see domain/repair.js): some
// lines move to their real (estimated) date, duplicates go to the recycle
// bin. Returns what undoRepair needs to put everything back.
export async function applyRepair({ move = [], moveTo = null, drop = [] }) {
  const before = state.txs.filter((t) => move.includes(t.id)).map((t) => ({ id: t.id, tx_date: t.tx_date, source: t.source || null }));
  for (let i = 0; i < move.length; i += 200) {
    // Marked, so the advisor never "finds" the moved lines again (they now share a day).
    const { error } = await sb.from('transactions').update({ tx_date: moveTo, source: REPAIRED }).in('id', move.slice(i, i + 200)).eq('household_id', state.hid);
    if (error) throw error;
  }
  const moved = new Set(move);
  state.txs = state.txs.map((t) => (moved.has(t.id) ? { ...t, tx_date: moveTo, source: REPAIRED } : t));
  if (drop.length) await removeMany(drop);
  else emit();
  return { before, drop };
}

export async function undoRepair({ before = [], drop = [] }) {
  const byDate = new Map();
  for (const b of before) { const k = b.tx_date + '|' + (b.source || ''); if (!byDate.has(k)) byDate.set(k, []); byDate.get(k).push(b.id); }
  for (const [k, ids] of byDate) {
    const [tx_date, source] = k.split('|');
    const { error } = await sb.from('transactions').update({ tx_date, source: source || null }).in('id', ids).eq('household_id', state.hid);
    if (error) throw error;
  }
  if (drop.length) {
    // Back from the recycle bin, where removeMany put them.
    const { data, error } = await sb.from('recycle_bin').select('id').eq('household_id', state.hid).eq('tbl', 'transactions').is('restored_at', null).in('row_id', drop);
    if (error) throw error;
    for (const row of data || []) {
      const { error: e } = await sb.rpc('restore_from_bin', { p_id: row.id });
      if (e) throw e;
    }
  }
  await load(state.hid, state.userId, { force: true });
}

// Changes the category of several transactions at once and returns what is
// needed to undo it.
export async function setCategory(ids, category_id, subcategory_id = null) {
  const before = state.txs.filter((t) => ids.includes(t.id)).map((t) => ({ id: t.id, category_id: t.category_id || null, subcategory_id: t.subcategory_id || null }));
  const { error } = await sb.from('transactions').update({ category_id, subcategory_id }).in('id', ids).eq('household_id', state.hid);
  if (error) throw error;
  state.txs = state.txs.map((t) => (ids.includes(t.id) ? { ...t, category_id, subcategory_id } : t));
  emit();
  return before;
}

export async function restoreCategories(before) {
  const groups = new Map();
  for (const b of before) {
    const k = (b.category_id || '') + '|' + (b.subcategory_id || '');
    if (!groups.has(k)) groups.set(k, { category_id: b.category_id, subcategory_id: b.subcategory_id, ids: [] });
    groups.get(k).ids.push(b.id);
  }
  for (const g of groups.values()) {
    const { error } = await sb.from('transactions').update({ category_id: g.category_id, subcategory_id: g.subcategory_id }).in('id', g.ids).eq('household_id', state.hid);
    if (error) throw error;
  }
  const map = new Map(before.map((b) => [b.id, b]));
  state.txs = state.txs.map((t) => (map.has(t.id) ? { ...t, ...map.get(t.id) } : t));
  emit();
}

// Hides the transaction right away and deletes it only after the undo window.
export function deleteWithUndo(id) {
  state.hidden.add(id);
  emit();
  const timer = setTimeout(async () => {
    pendingDeletes.delete(id);
    const { error } = await sb.from('transactions').delete().eq('id', id).eq('household_id', state.hid);
    if (error) {
      state.hidden.delete(id);
      emit();
      showToast('המחיקה נכשלה. התנועה חזרה לרשימה.');
      return;
    }
    state.txs = state.txs.filter((t) => t.id !== id);
    state.hidden.delete(id);
    emit();
  }, DELETE_DELAY_MS);
  pendingDeletes.set(id, timer);
  return () => {
    clearTimeout(pendingDeletes.get(id));
    pendingDeletes.delete(id);
    state.hidden.delete(id);
    emit();
  };
}

// Leaving the page during the undo window still deletes.
window.addEventListener('pagehide', () => {
  for (const [id, timer] of pendingDeletes) {
    clearTimeout(timer);
    sb.from('transactions').delete().eq('id', id).eq('household_id', state.hid);
  }
});

// Used to undo an add: removes it right away.
export async function deleteNow(id) {
  const { error } = await sb.from('transactions').delete().eq('id', id).eq('household_id', state.hid);
  if (error) throw error;
  state.txs = state.txs.filter((t) => t.id !== id);
  emit();
}
