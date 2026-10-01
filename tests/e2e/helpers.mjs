// Shared setup for browser tests: the real server, Chromium, and an
// in-memory fake of the Supabase REST API (no real data is ever touched).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startServer() {
  const port = 19000 + Math.floor(Math.random() * 900);
  const proc = spawn(process.execPath, [path.join(ROOT, 'budget-ai-server.js')], {
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    proc.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (code) => reject(new Error('server exited ' + code)));
  });
  return { base: `http://127.0.0.1:${port}`, stop: () => proc.kill() };
}

export async function launchBrowser() {
  const opts = {};
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// A household with categories, budgets and ~14 months of transactions.
export function makeFakeDb(today = new Date()) {
  const hid = 'h1';
  const categories = [
    { id: 'food', name: 'אוכל', icon: '🍽️', kind: 'expense', parent_id: null, household_id: hid },
    { id: 'super', name: 'סופר', icon: null, kind: 'expense', parent_id: 'food', household_id: hid },
    { id: 'cafe', name: 'מסעדות ואוכל בחוץ', icon: null, kind: 'expense', parent_id: 'food', household_id: hid },
    { id: 'car', name: 'רכב', icon: '🚗', kind: 'expense', parent_id: null, household_id: hid },
    { id: 'home', name: 'בית ודיור', icon: '🏠', kind: 'expense', parent_id: null, household_id: hid },
    { id: 'sal', name: 'משכורת', icon: '💼', kind: 'income', parent_id: null, household_id: hid }
  ];
  const txs = [];
  let n = 0;
  const add = (o) => txs.push({ id: 't' + (++n), household_id: hid, created_by: 'u1', nature: 'variable', spread: 'month', source: 'manual', payment_method: 'ויזה 4821', created_at: o.tx_date + 'T10:00:00Z', ...o });
  for (let back = 13; back >= 0; back--) {
    const y = today.getFullYear();
    const m = today.getMonth() - back;
    const day = (d) => iso(new Date(y, m, d));
    const lastDay = back === 0 ? today.getDate() : 28;
    add({ type: 'income', amount: 18400, description: 'משכורת', tx_date: day(Math.min(10, lastDay)), category_id: 'sal', nature: 'fixed' });
    add({ type: 'expense', amount: 4500, description: 'משכנתא', tx_date: day(1), category_id: 'home', nature: 'fixed' });
    for (let d = 2; d <= lastDay; d += 3) {
      add({ type: 'expense', amount: 300 + ((d * 37 + back * 11) % 200), description: 'שופרסל דיל ' + (d % 3 === 0 ? '1234' : ''), tx_date: day(d), category_id: 'food', subcategory_id: 'super' });
      add({ type: 'expense', amount: 40 + (d % 4) * 6, description: 'ארומה', tx_date: day(d), category_id: 'food', subcategory_id: 'cafe' });
    }
    add({ type: 'expense', amount: 280, description: 'סונול', tx_date: day(Math.min(5, lastDay)), category_id: 'car' });
  }
  add({ type: 'expense', amount: 3600, description: 'ביטוח רכב שנתי', tx_date: iso(new Date(today.getFullYear(), today.getMonth() - 2, 5)), category_id: 'car', spread: 'year' });
  return {
    hid,
    tables: {
      transactions: txs,
      categories,
      category_budgets: [{ household_id: hid, category_id: 'food', monthly_amount: 3000 }, { household_id: hid, category_id: 'car', monthly_amount: 900 }],
      memberships: [{ household_id: hid, user_id: 'u1', display_name: 'יוסי ודני', role: 'owner', created_at: '2026-01-01' }]
    }
  };
}

// Minimal PostgREST: eq / gte / in filters, order, offset/limit, insert, update, delete.
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'gte') out = out.filter((r) => String(r[k]) >= val);
    else if (op === 'in') {
      const set = new Set(val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')));
      out = out.filter((r) => set.has(String(r[k])));
    }
  }
  return out;
}

export async function mockSupabase(page, db, calls = []) {
  await page.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/\/rest\/v1\/([a-z_]+)/);
    if (!m) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const table = db.tables[m[1]] || (db.tables[m[1]] = []);
    const method = req.method();
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    calls.push({ method, table: m[1], query: url.search });
    const reply = (rows) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? rows[0] : rows) });
    if (method === 'GET') {
      let rows = applyFilters(table, url.searchParams);
      const order = url.searchParams.get('order');
      if (order) {
        const [col, dir] = order.split('.');
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const off = Number(url.searchParams.get('offset') || 0);
      const lim = url.searchParams.get('limit');
      if (lim) rows = rows.slice(off, off + Number(lim));
      return reply(rows);
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const rows = (Array.isArray(body) ? body : [body]).map((r) => ({ id: 'new' + (table.length + 1), created_at: new Date().toISOString(), ...r }));
      table.push(...rows);
      return reply(rows);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      const rows = applyFilters(table, url.searchParams);
      rows.forEach((r) => Object.assign(r, body));
      return reply(rows);
    }
    if (method === 'DELETE') {
      const rows = applyFilters(table, url.searchParams);
      db.tables[m[1]] = table.filter((r) => !rows.includes(r));
      return reply(rows);
    }
    return route.fulfill({ status: 405, body: '' });
  });
  await page.route('**/fonts.g*/**', (r) => r.abort());
}

// A signed-in session in the same storage key supabase-js uses.
export async function signIn(page, base) {
  await page.goto(base + '/app/');
  await page.evaluate(() => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const b = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    localStorage.setItem('sb-bwwupwbakefjhwropdin-auth-token', JSON.stringify({
      access_token: b({ alg: 'HS256' }) + '.' + b({ sub: 'u1', exp }) + '.s', token_type: 'bearer', expires_in: 3600, expires_at: exp,
      refresh_token: 'r', user: { id: 'u1', email: 'yossi@example.com', aud: 'authenticated' }
    }));
  });
  await page.reload();
}

export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('Content Security Policy') || (m.type() === 'error' && !t.includes('net::ERR_FAILED'))) errors.push(t);
  });
  return errors;
}
