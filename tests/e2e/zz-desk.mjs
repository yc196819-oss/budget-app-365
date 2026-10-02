import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn } from './helpers.mjs';
const out = process.argv[2]; const w = Number(process.argv[3] || 1440);
const server = await startServer(); const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: w, height: 900 } });
const db = makeFakeDb(); db.tables.households = [{ id: 'h1', decision_threshold: 500, personal_allowance: 400 }];
db.tables.memberships.push({ household_id: 'h1', user_id: 'u2', display_name: 'דני', role: 'member' });
db.tables.goals = [{ id: 'g1', household_id: 'h1', name: 'קרן חירום', target_amount: 30000, saved_amount: 12000, plan_items: [] }];
db.tables.shared_decisions = [{ id: 'd1', household_id: 'h1', created_by: 'u2', title: 'מכונת כביסה', amount: 2400, note: 'הישנה נשברה', status: 'open', created_at: new Date().toISOString() }]; db.tables.decision_votes = [];
await mockSupabase(page, db); await signIn(page, server.base);
for (const tab of ['home', 'money', 'together', 'plans', 'assets']) {
  await page.goto(server.base + '/app/#/' + tab); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${tab}-${w}.png` });
}
await browser.close(); server.stop();
