import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function open({ email, setup } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errors = collectErrors(page);
  const db = makeFakeDb();
  const sent = [];
  await page.route('**/api/telemetry', (r) => { sent.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 204, body: '' }); });
  if (setup) setup(db);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  if (email) {
    await page.evaluate((e) => {
      const k = 'sb-bwwupwbakefjhwropdin-auth-token';
      const s = JSON.parse(localStorage.getItem(k)); s.user.email = e; localStorage.setItem(k, JSON.stringify(s));
    }, email);
  }
  await page.goto(server.base + '/app/#/home');
  await page.reload();
  await page.waitForSelector('.hero');
  return { page, errors, db, sent };
}

test('export: two files, everything as JSON and the transactions as a CSV for Excel', async () => {
  const { page, errors } = await open();
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=ייצוא המידע ונמחקו לאחרונה');
  const files = [];
  page.on('download', (d) => files.push(d));
  await page.click('text=להוריד את כל המידע');
  await page.waitForFunction(() => document.body.textContent.includes('ירדו שני קבצים'));
  await page.waitForTimeout(300);
  assert.equal(files.length, 2);
  const byName = Object.fromEntries(await Promise.all(files.map(async (d) => [d.suggestedFilename().replace(/-\d{4}-\d\d-\d\d/, ''), await readFile(await d.path(), 'utf8')])));
  const all = JSON.parse(byName['budget-all.json']);
  assert.ok(all.tables.transactions.length > 100);
  assert.equal(all.tables.categories.length, 6);
  assert.deepEqual(all.failed, []);
  const csv = byName['budget-transactions.csv'];
  assert.ok(csv.startsWith('﻿tx_date,type,amount,description,category'));
  assert.match(csv, /,expense,280,סונול,רכב,/);
  assert.equal(csv.trim().split('\r\n').length, all.tables.transactions.length + 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('recycle bin: what was deleted is listed with the days left, and comes back with one tap', async () => {
  const removed = new Date(Date.now() - 2 * 86400000).toISOString();
  const restored = [];
  const { page, errors, db } = await open({
    setup: (d) => {
      d.tables.recycle_bin = [
        { id: 7, household_id: 'h1', tbl: 'transactions', removed_at: removed, data: { id: 'gone1', household_id: 'h1', type: 'expense', amount: 999, description: 'מחשב נייד', tx_date: new Date().toISOString().slice(0, 10), category_id: 'home' } },
        { id: 8, household_id: 'h1', tbl: 'goals', removed_at: removed, data: { id: 'g9', household_id: 'h1', name: 'חופשה ביוון', target_amount: 9000 } }
      ];
    }
  });
  await page.route('**/rest/v1/rpc/restore_from_bin', (r) => {
    const { p_id } = JSON.parse(r.request().postData());
    restored.push(p_id);
    const item = db.tables.recycle_bin.find((x) => x.id === p_id);
    db.tables.transactions.push(item.data);
    item.restored_at = new Date().toISOString();
    return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=ייצוא המידע ונמחקו לאחרונה');
  const bin = page.locator('.recycle-bin');
  await bin.locator('.bin-row').first().waitFor();
  assert.equal(await bin.locator('.bin-row').count(), 2);
  assert.match(await bin.textContent(), /מחשב נייד/);
  assert.match(await bin.textContent(), /עוד 28 ימים/);
  await page.click('button[aria-label="להחזיר: מחשב נייד"]');
  await page.waitForFunction(() => document.querySelectorAll('.recycle-bin .bin-row').length === 1);
  assert.deepEqual(restored, [7]);
  await page.waitForSelector('text=חזר למקום');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the usage switch: on by default, and off stops sending anything from this device', async () => {
  const { page, sent } = await open();
  await page.waitForTimeout(4500);
  assert.ok(sent.some((b) => b.events.includes('app_open')), 'opening the app is counted');
  await page.click('button[aria-label="פרופיל והגדרות"]');
  const sw = page.locator('input[aria-label="עזרה בשיפור האפליקציה"]');
  assert.equal(await sw.isChecked(), true);
  await sw.click();
  assert.equal(await page.evaluate(() => localStorage.getItem('telemetry:off')), '1');
  const before = sent.length;
  await page.evaluate(() => { location.hash = '#/money'; });
  await page.reload();
  await page.waitForSelector('.hero, .money, main');
  await page.waitForTimeout(4500);
  assert.equal(sent.length, before);
  await page.close();
});

test('owner dashboard: only for the owner, with active people, return rate and failures', async () => {
  const { page: other } = await open();
  await other.click('button[aria-label="פרופיל והגדרות"]');
  assert.equal(await other.locator('text=לוח בעלים').count(), 0);
  await other.close();

  const { page, errors } = await open({ email: 'budgetapp2852@gmail.com' });
  await page.route('**/api/admin/stats', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    active: { day: 3, week: 11, month: 25 }, retention: { started: 10, cameBack: 6, pct: 60 }, members: 31,
    use: [{ name: 'tx_add', count: 120 }], errors: { week: 2, top: [{ message: 'boom', count: 2, path: '#/home' }] }
  }) }));
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=לוח בעלים');
  const s = page.locator('.admin-stats');
  await s.locator('text=חזרו אחרי שבוע').waitFor();
  const t = await s.textContent();
  assert.match(t, /60%/);
  assert.match(t, /הוספת תנועה/);
  assert.match(t, /boom/);
  assert.deepEqual(errors, []);
  await page.close();
});
