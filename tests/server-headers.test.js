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

test('every response gets the basic security headers', async () => {
  const res = await fetch(BASE + '/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('the current app is not given the strict CSP (it would break)', async () => {
  const res = await fetch(BASE + '/');
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
