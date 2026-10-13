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

const SCREENS = ['#/home', '#/money', '#/together', '#/plans', '#/plans/budget', '#/plans/trips', '#/assets'];

for (const scheme of ['light', 'dark']) {
  test(`the app's screens pass WCAG 2 AA (${scheme})`, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, reducedMotion: 'reduce', bypassCSP: true });
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
