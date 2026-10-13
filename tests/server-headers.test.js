// Starts the real server on a free port and checks the security headers and
// the new-app routes. No Supabase credentials are needed for these routes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'budget-ai-server.js')], {
    env: { ...process.env, PORT: String(PORT), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    server.on('exit', (code) => reject(new Error('server exited ' + code)));
  });
});

after(() => { if (server) server.kill(); });

test('the main address opens the new app, keeping the query string', async () => {
  const res = await fetch(BASE + '/', { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/app/');
  const inv = await fetch(BASE + '/?invite=abc123', { redirect: 'manual' });
  assert.equal(inv.headers.get('location'), '/app/?invite=abc123');
});

test('the previous version stays available at /old/', async () => {
  const res = await fetch(BASE + '/old/');
  assert.equal(res.status, 200);
  assert.doesNotMatch(await res.text(), /src\/main\.js/);
  const bare = await fetch(BASE + '/old', { redirect: 'manual' });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get('location'), '/old/');
});

test('every response gets the basic security headers', async () => {
  const res = await fetch(BASE + '/old/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('the previous app is not given the strict CSP (it would break)', async () => {
  const res = await fetch(BASE + '/old/');
  assert.equal(res.headers.get('content-security-policy'), null);
});

test('the new app gets a strict CSP that allows exactly its import map', async () => {
  const res = await fetch(BASE + '/app/');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const body = await res.text();
  assert.match(body, /<script type="importmap">/);
});

test('deep links under /app return the app shell', async () => {
  const res = await fetch(BASE + '/app/anything/here');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /src\/main\.js/);
});

test('vendor route serves only the allowed files', async () => {
  const ok = await fetch(BASE + '/app/vendor/preact.js');
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /javascript/);
  const bad = await fetch(BASE + '/app/vendor/package.json');
  assert.equal(bad.status, 404);
  const traversal = await fetch(BASE + '/app/vendor/..%2F..%2Fbudget-ai-server.js');
  assert.notEqual(traversal.status, 200);
});

test('pdf.js and its worker are served as JavaScript modules', async () => {
  for (const f of ['pdf.js', 'pdf.worker.js']) {
    const res = await fetch(BASE + '/app/vendor/' + f);
    assert.equal(res.status, 200, f);
    assert.match(res.headers.get('content-type'), /javascript/, f);
  }
});

test('protected API routes still require a session', async () => {
  const res = await fetch(BASE + '/api/ai/advice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok(res.status === 401 || res.status === 503);
});

test('the new app shell preloads every module, and every preloaded file exists', async () => {
  const res = await fetch(BASE + '/app/');
  const html = await res.text();
  const links = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  assert.ok(links.includes('/app/src/main.js'));
  assert.ok(links.includes('/app/vendor/preact.js'));
  assert.ok(links.length > 50, 'all modules listed: ' + links.length);
  // Preloads come before the entry module, so they start first.
  assert.ok(html.indexOf('modulepreload') < html.indexOf('<script type="module"'));
  for (const l of links) {
    const r = await fetch(BASE + l);
    assert.equal(r.status, 200, l);
    assert.match(r.headers.get('content-type'), /javascript/, l);
  }
});

test('the service worker keeps only the app\'s own files; the API and Supabase never pass through it', async () => {
  const sw = await (await fetch(BASE + '/sw.js')).text();
  assert.match(sw, /url\.origin !== self\.location\.origin\) return/, 'cross-origin (Supabase) is not intercepted');
  const rule = new RegExp(sw.match(/const STATIC = \/(.+)\/;/)[1]);
  for (const p of ['/app/src/main.js', '/app/styles/base.css', '/app/vendor/preact.js', '/wallet.svg', '/wallet-192.png', '/manifest.json']) assert.ok(rule.test(p), p);
  for (const p of ['/api/ai/advice-chat-stream', '/api/fx/rate', '/api/decisions/notify', '/old/']) assert.equal(rule.test(p), false, p);
  assert.ok(sw.includes('if (url.search && !/^\\?action=[a-z]+$/.test(url.search)) return'), 'sign-in and invite links go to the network; a shortcut (?action=) opens the shell');
  for (const p of ['/shortcut-add.png', '/shortcut-talk.svg']) assert.ok(rule.test(p), p);
  assert.match(sw, /app-updated/);
  assert.match(sw, /existing\.navigate/);
});

test('decision notifications need a signed-in member', async () => {
  const res = await fetch(BASE + '/api/decisions/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"decisionId":"x","event":"opened"}' });
  assert.ok(res.status === 401 || res.status === 503, String(res.status));
});

test('the logo and the manifest: installable from the new app, on phone and desktop', async () => {
  const icon = await (await fetch(BASE + '/wallet.svg')).text();
  assert.match(icon, /id="wallet"/);
  assert.doesNotMatch(icon, /<text/, 'no font-dependent text in the logo');
  const m = await (await fetch(BASE + '/manifest.json')).json();
  assert.equal(m.start_url, '/app/');
  assert.equal(m.name, 'התקציב שלנו');
  assert.equal(m.orientation, undefined, 'no portrait lock, so it installs on desktop too');
  for (const i of m.icons) assert.equal((await fetch(BASE + i.src)).status, 200, i.src);
  const shell = await (await fetch(BASE + '/app/')).text();
  assert.match(shell, /<link rel="manifest" href="\/manifest.json">/);
  assert.match(shell, /<link rel="apple-touch-icon" href="\/wallet-180.png">/);
});

test('the exchange-rate endpoint needs a signed-in user', async () => {
  const res = await fetch(BASE + '/api/fx/rate?currency=USD&date=2026-09-13');
  assert.ok(res.status === 401 || res.status === 503, String(res.status));
});

test('the app loads its motion styles', async () => {
  const shell = await (await fetch(BASE + '/app/')).text();
  assert.match(shell, /<link rel="stylesheet" href=".\/styles\/motion.css">/);
  const css = await (await fetch(BASE + '/app/styles/motion.css')).text();
  assert.match(css, /@keyframes grow-x/);
});

test('public pages for downloading, privacy and account deletion: no sign-in, strict CSP, no inline code', async () => {
  for (const [route, text] of [['/download', 'הורדת האפליקציה'], ['/privacy', 'מדיניות פרטיות'], ['/delete-account', 'מחיקת חשבון']]) {
    const res = await fetch(BASE + route);
    assert.equal(res.status, 200, route);
    assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/, route);
    const html = await res.text();
    assert.ok(html.includes(text), route);
    assert.doesNotMatch(html, /style="|<style|<script>(?!<\/script>)|onclick=/i, route + ': nothing the CSP would block');
  }
  assert.equal((await fetch(BASE + '/app/pages/download.js')).status, 200);
  assert.match(await (await fetch(BASE + '/privacy')).text(), /4 הספרות האחרונות בלבד/);
});

test('Google Play asset links: none until the signing fingerprint is configured', async () => {
  const res = await fetch(BASE + '/.well-known/assetlinks.json');
  assert.equal(res.status, 404);
});

test('deleting an account needs a signed-in user', async () => {
  const res = await fetch(BASE + '/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirm":"מחיקה"}' });
  assert.ok(res.status === 401 || res.status === 503, String(res.status));
});

test('the manifest has a stable id and the finance category (for stores)', async () => {
  const m = await (await fetch(BASE + '/manifest.json')).json();
  assert.equal(m.id, '/app/');
  assert.ok(m.categories.includes('finance'));
});

test('home-screen shortcuts: add, by voice, ask and talk with the advisor, each with its icon', async () => {
  const m = await (await fetch(BASE + '/manifest.json')).json();
  assert.deepEqual(m.shortcuts.map((s) => s.url), ['/app/?action=add', '/app/?action=voice', '/app/?action=ask', '/app/?action=talk']);
  for (const s of m.shortcuts) {
    assert.ok(s.name && s.short_name, s.url);
    const icon = await fetch(BASE + s.icons[0].src);
    assert.equal(icon.status, 200, s.icons[0].src);
    assert.match(icon.headers.get('content-type'), /image\/png/);
  }
  const shell = await fetch(BASE + '/app/?action=add');
  assert.equal(shell.status, 200);
});
