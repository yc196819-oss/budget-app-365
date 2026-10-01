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

test('the service worker only handles page loads, so API and data requests never pass through it', async () => {
  const sw = await (await fetch(BASE + '/sw.js')).text();
  assert.match(sw, /e\.request\.mode !== 'navigate'/);
  assert.match(sw, /existing\.navigate/);
});

test('decision notifications need a signed-in member', async () => {
  const res = await fetch(BASE + '/api/decisions/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"decisionId":"x","event":"opened"}' });
  assert.ok(res.status === 401 || res.status === 503, String(res.status));
});
