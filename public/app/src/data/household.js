import { sb } from '../lib/supabase.js';
import { showToast } from '../lib/toast.js';
import { isoDate } from '../domain/money.js';
import { readCache, writeCache } from '../lib/storage.js';

// Household data for the new app: transactions of the last ~2 years (enough
// for 12 months plus expenses spread over a year), categories, monthly
// budgets and member names. Loaded once per household and shared by all
// screens through useHousehold().

const PAGE = 1000;
const MONTHS_BACK = 23;
const DELETE_DELAY_MS = 5000;

const state = { hid: null, userId: null, status: 'idle', error: null, txs: [], categories: [], budgets: [], members: {}, accounts: [], cards: [], goals: [], installments: [], loans: [], investments: [], income: [], hidden: new Set(), refreshing: false };
const listeners = new Set();
const pendingDeletes = new Map();

// What is kept on the device for an instant start (not the pending deletes).
const CACHED = ['txs', 'categories', 'budgets', 'members', 'accounts', 'cards', 'goals', 'installments', 'loans', 'investments', 'income'];
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
    status: state.status,
    error: state.error,
    refreshing: state.refreshing,
    txs: state.txs.filter((t) => !state.hidden.has(t.id)),
    categories: state.categories,
    budgets: state.budgets,
    members: state.members,
    accounts: state.accounts,
    cards: state.cards,
    goals: state.goals,
    installments: state.installments,
    loans: state.loans,
    investments: state.investments,
    income: state.income
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
    const [txs, cats, budgets, mems, accounts, cards, goals, installments, loans, investments, household] = await Promise.all([
      fetchAllTransactions(hid, since),
      sb.from('categories').select('id,name,icon,kind,parent_id').eq('household_id', hid),
      sb.from('category_budgets').select('category_id,monthly_amount').eq('household_id', hid),
      sb.from('memberships').select('user_id,display_name').eq('household_id', hid),
      sb.from('bank_accounts').select('id,name,balance,balance_updated_at').eq('household_id', hid),
      sb.from('credit_cards').select('id,name,bank_account_id,billing_day,last4,owner_user_id,credit_limit,is_active').eq('household_id', hid),
      sb.from('goals').select('*').eq('household_id', hid),
      sb.from('installments').select('*').eq('household_id', hid),
      sb.from('loans').select('*').eq('household_id', hid),
      sb.from('investments').select('*').eq('household_id', hid),
      sb.from('households').select('income_expectations').eq('id', hid).maybeSingle()
    ]);
    for (const r of [cats, budgets, mems]) if (r.error) throw r.error;
    // Accounts, cards, goals, installments, loans and investments add to home,
    // plans and assets: if one of them fails, those screens still work without it.
    if (state.hid !== hid) return;
    Object.assign(state, {
      status: 'ready',
      refreshing: false,
      txs,
      categories: cats.data || [],
      budgets: budgets.data || [],
      members: Object.fromEntries((mems.data || []).map((m) => [m.user_id, m.display_name || ''])),
      accounts: accounts.error ? [] : accounts.data || [],
      cards: cards.error ? [] : (cards.data || []).filter((c) => c.is_active !== false),
      goals: goals.error ? [] : goals.data || [],
      installments: installments.error ? [] : installments.data || [],
      loans: loans.error ? [] : loans.data || [],
      investments: investments.error ? [] : investments.data || [],
      income: !household.error && household.data && Array.isArray(household.data.income_expectations) ? household.data.income_expectations : [],
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

// The monthly net income the household expects (households.income_expectations,
// the lines the previous app edits). The approved total becomes one line,
// keeping its name when there was a single line.
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

// Saves the lines of an imported statement. Returns the new rows.
export async function addImported(rows) {
  const added = [];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, household_id: state.hid, created_by: state.userId }));
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
