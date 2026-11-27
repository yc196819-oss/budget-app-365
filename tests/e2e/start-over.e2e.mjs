// Starting over, in "המידע שלנו": the owner's flow, a member's note, and
// bringing a whole start over back from the recycle bin. Made-up family only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn } from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser.close(); server.stop(); });

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openData(db, routes = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/api/telemetry', (r) => r.fulfill({ status: 204, body: '' }));
  await mockSupabase(page, db);
  // Registered after the fake database, so these win.
  await page.route('**/rest/v1/rpc/bin_batches', (r) => r.fulfill(json(routes.batches || [])));
  for (const [path, fn] of Object.entries(routes.api || {})) await page.route(path, fn);
  await signIn(page, server.base);
  await page.goto(server.base + '/app/#/home'); await page.reload(); await page.waitForSelector('.hero');
  await page.click('button[aria-label="פרופיל והגדרות"]');
  await page.click('text=המידע שלנו: קבצים, ייצוא ושחזור');
  await page.waitForSelector('.start-over');
  return page;
}

test('the owner gets a code, and the button opens only with the code and the words', async () => {
  const sent = [];
  const page = await openData(makeFakeDb(), { api: {
    '**/api/household/start-over/code': (r) => { sent.push('code'); return r.fulfill(json({ sent: true, to: 'd***@example.com' })); },
    '**/api/household/start-over': (r) => { sent.push(JSON.parse(r.request().postData())); return r.fulfill(json({ ok: true, removed: 42, batch: 'b1', told: 1 })); }
  } });
  const card = page.locator('.start-over');
  await card.getByRole('button', { name: 'להתחיל מחדש' }).click();
  await page.waitForSelector('text=הקוד מהמייל');
  assert.deepEqual(sent, ['code']);
  assert.match(await card.innerText(), /d\*\*\*@example\.com/);
  const go = card.getByRole('button', { name: 'למחוק ולהתחיל מחדש' });
  assert.equal(await go.isDisabled(), true);
  await card.locator('input[inputmode="numeric"]').fill('482913');
  assert.equal(await go.isDisabled(), true, 'the words are still missing');
  await card.locator('input[autocomplete="off"]').fill('להתחיל');
  assert.equal(await go.isDisabled(), true, 'the words must match');
  await card.locator('input[autocomplete="off"]').fill('להתחיל מחדש');
  assert.equal(await go.isDisabled(), false);
  await go.click();
  await page.waitForSelector('text=הנתונים נמחקו');
  assert.deepEqual(sent[1], { code: '482913', confirm: 'להתחיל מחדש' });
  await page.close();
});

test('an error from the server is shown in the card', async () => {
  const page = await openData(makeFakeDb(), { api: {
    '**/api/household/start-over/code': (r) => r.fulfill(json({ sent: true, to: 'd***@example.com' })),
    '**/api/household/start-over': (r) => r.fulfill(json({ error: 'הקוד לא נכון. נסו שוב.' }, 400))
  } });
  const card = page.locator('.start-over');
  await card.getByRole('button', { name: 'להתחיל מחדש' }).click();
  await card.locator('input[inputmode="numeric"]').fill('111111');
  await card.locator('input[autocomplete="off"]').fill('להתחיל מחדש');
  await card.getByRole('button', { name: 'למחוק ולהתחיל מחדש' }).click();
  await card.locator('[role="alert"]').waitFor();
  assert.match(await card.locator('[role="alert"]').innerText(), /הקוד לא נכון/);
  await page.close();
});

test('the card passes WCAG 2 AA, closed and open, light and dark', async () => {
  const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, reducedMotion: 'reduce', bypassCSP: true });
    await page.route('**/api/telemetry', (r) => r.fulfill({ status: 204, body: '' }));
    await mockSupabase(page, makeFakeDb());
    await page.route('**/rest/v1/rpc/bin_batches', (r) => r.fulfill(json([{ batch: 'b1', n: 42, removed_at: new Date().toISOString() }])));
    await page.route('**/api/household/start-over/code', (r) => r.fulfill(json({ sent: true, to: 'd***@example.com' })));
    await signIn(page, server.base);
    await page.goto(server.base + '/app/#/home'); await page.reload(); await page.waitForSelector('.hero');
    await page.click('button[aria-label="פרופיל והגדרות"]');
    await page.click('text=המידע שלנו: קבצים, ייצוא ושחזור');
    await page.waitForSelector('.bin-batch');
    await page.addScriptTag({ content: AXE });
    const check = async () => {
      await page.waitForTimeout(500);
      return page.evaluate(async () => (await window.axe.run(['.start-over', '.bin-batch'].map((s) => document.querySelector(s)).filter(Boolean),
        { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] })).violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(', ')));
    };
    assert.deepEqual(await check(), [], scheme + ' closed');
    await page.locator('.start-over').getByRole('button', { name: 'להתחיל מחדש' }).click();
    await page.waitForSelector('text=הקוד מהמייל');
    assert.deepEqual(await check(), [], scheme + ' open');
    await page.close();
  }
});

test('a member sees who can start over, and no button', async () => {
  const db = makeFakeDb();
  db.tables.memberships[0].role = 'member';
  const page = await openData(db);
  const card = page.locator('.start-over');
  await card.locator('text=רק מי שפתח את הבית').waitFor();
  assert.equal(await card.getByRole('button').count(), 0);
  await page.close();
});

test('a start over in the bin comes back with one tap', async () => {
  const restored = [];
  const db = makeFakeDb();
  const page = await openData(db, {
    batches: [{ batch: 'b1', n: 42, removed_at: new Date(Date.now() - 2 * 86400000).toISOString() }],
    api: { '**/rest/v1/rpc/restore_batch': (r) => { restored.push(JSON.parse(r.request().postData())); return r.fulfill(json(42)); } }
  });
  const row = page.locator('.bin-batch');
  await row.waitFor();
  assert.match(await row.innerText(), /42/);
  await row.getByRole('button', { name: 'להחזיר הכל' }).click();
  await page.waitForSelector('text=הכל חזר למקום');
  assert.deepEqual(restored, [{ p_batch: 'b1' }]);
  await page.close();
});
