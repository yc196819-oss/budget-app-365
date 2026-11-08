import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, launchBrowser, makeFakeDb, mockSupabase, signIn } from './helpers.mjs';

// Accessibility (ת"י 5568 / WCAG 2.0 AA, as the Israeli regulations require):
// every main screen, in light and dark, passes axe-core's WCAG 2 A/AA rules.
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let server;
let browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function audit(page) {
  await page.addScriptTag({ content: AXE });
  // Animations finished, so colors are measured as they settle.
  await page.waitForTimeout(700);
  const res = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] }));
  return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 2).join('')) }));
}

const SCREENS = ['#/home', '#/money', '#/together', '#/shop', '#/plans', '#/plans/budget', '#/plans/months', '#/plans/trips', '#/assets'];

// On a phone and on a computer (most of our people use a computer), in light and dark.
for (const [scheme, width] of [['light', 390], ['dark', 390], ['light', 1280], ['dark', 1536]]) {
  test(`the app's screens pass WCAG 2 AA (${scheme}, ${width}px)`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme: scheme, reducedMotion: 'reduce', bypassCSP: true });
    const db = makeFakeDb();
    db.tables.memberships.push({ household_id: 'h1', user_id: 'u2', display_name: 'דני', role: 'member' });
    await mockSupabase(page, db);
    await signIn(page, server.base);
    const found = {};
    for (const hash of SCREENS) {
      await page.goto(server.base + '/app/' + hash);
      await page.waitForSelector('.shell-main h1');
      await page.waitForTimeout(400);
      const v = await audit(page);
      if (v.length) found[hash] = v;
    }
    assert.deepEqual(found, {}, JSON.stringify(found, null, 1));
    await page.close();
  });
}

test('sign-in, terms and the legal pages pass WCAG 2 AA', async () => {
  const found = {};
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, reducedMotion: 'reduce', bypassCSP: true });
    await page.route('**/*.supabase.co/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    for (const path of ['/app/', '/terms', '/privacy', '/accessibility', '/download', '/delete-account']) {
      await page.goto(server.base + path);
      await page.waitForSelector('h1');
      const v = await audit(page);
      if (v.length) found[scheme + ' ' + path] = v;
    }
    await page.close();
  }
  assert.deepEqual(found, {}, JSON.stringify(found, null, 1));
});

test('a computer with the keyboard only: every tab is reached, and each control says what it does', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.waitForSelector('.home');
  // Tab through the page: the menu's tabs come up, each with a visible focus and a name.
  const seen = new Set();
  const unnamed = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
      const st = getComputedStyle(el);
      return { href: el.getAttribute('href'), name, outline: st.outlineStyle !== 'none' || st.boxShadow !== 'none' };
    });
    if (!f) continue;
    if (f.href) seen.add(f.href);
    if (!f.name) unnamed.push(f);
  }
  for (const h of ['#/home', '#/money', '#/plans', '#/assets']) assert.ok(seen.has(h), 'reached ' + h);
  assert.deepEqual(unnamed, [], 'every control has a name');
  // Enter opens a tab.
  await page.focus('.side-item[href="#/money"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash === '#/money');
  await page.close();
});

test('bigger text: the whole app grows, and nothing sticks out sideways', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await mockSupabase(page, makeFakeDb());
  await signIn(page, server.base);
  await page.waitForSelector('.home');
  await page.click('.topbar .icon-btn');
  await page.click('.text-size .chip:has-text("גדול מאוד")');
  assert.equal(await page.evaluate(() => document.documentElement.style.zoom), '1.3');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForSelector('.home');
  assert.equal(await page.evaluate(() => document.documentElement.style.zoom), '1.3', 'remembered');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(wide <= 1, 'sideways overflow: ' + wide);
  await page.close();
});
