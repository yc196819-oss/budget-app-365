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

test('the previous version is gone: its address and any other page open the app', async () => {
  for (const p of ['/old/', '/old']) {
    const res = await fetch(BASE + p, { redirect: 'manual' });
    assert.equal(res.status, 301, p);
    assert.equal(res.headers.get('location'), '/app/', p);
  }
  const other = await fetch(BASE + '/some/page', { redirect: 'manual' });
  assert.equal(other.status, 302);
  assert.equal(other.headers.get('location'), '/app/');
  assert.equal((await fetch(BASE + '/index.html', { redirect: 'manual' })).status, 302, 'the old app file is not served');
  assert.equal((await fetch(BASE + '/api/nothing-here', { redirect: 'manual' })).status, 404);
});

test('every response gets the basic security headers', async () => {
  const res = await fetch(BASE + '/privacy');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
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
  // A tapped notification opens its screen: the open window is told where to go.
  assert.match(sw, /postMessage\(\{ type: 'open', url \}\)/);
  assert.match(sw, /openWindow\(url\)/);
  // The status-bar icon is a one-color silhouette (a full-color one shows as a white square).
  assert.match(sw, /badge: '\/badge-96\.png'/);
  assert.ok(rule.test('/badge-96.png'));
  // Links from notifications stay inside the app: old ?tab= links and other sites open home.
  const openUrl = new Function('self', sw.slice(sw.indexOf('function openUrl'), sw.indexOf('// A tap opens')) + '; return openUrl;')({ location: { origin: 'https://x.app' } });
  assert.equal(openUrl('/app/#/together/abc'), '/app/#/together/abc');
  assert.equal(openUrl('/app/?action=ask'), '/app/?action=ask');
  assert.equal(openUrl('https://x.app/?tab=dash'), '/app/#/home');
  assert.equal(openUrl('https://evil.example/app/'), '/app/#/home');
  assert.equal(openUrl(undefined), '/app/');
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
  assert.match(shell, /<link rel="apple-touch-icon" href="\/wallet-180.png\?v=\d+">/);
  // Full-bleed squares only: the launcher draws its own shape. An SVG with its
  // own rounded corners would be shrunk inside it ("an icon pasted on an icon").
  assert.ok(m.icons.every((i) => /\.png\?v=\d+$/.test(i.src)), 'png icons with a version');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
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
  for (const [route, text] of [['/download', 'הורדת האפליקציה'], ['/privacy', 'מדיניות פרטיות'], ['/delete-account', 'מחיקת חשבון'], ['/security', 'איך אנחנו שומרים עליכם']]) {
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

test('the preview of an email: its design, framed only by the app itself, with no scripts', async () => {
  const res = await fetch(BASE + '/mail-preview/more');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /wallet-192\.png/);
  assert.match(html, /להוסיף עוד פירוט/);
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal((await fetch(BASE + '/mail-preview/nope')).status, 404);
});

test('two-step login routes need a signed-in person', async () => {
  for (const [method, path] of [['GET', '/api/2fa/status'], ['POST', '/api/2fa/email/send'], ['POST', '/api/2fa/email/verify'], ['POST', '/api/2fa/email/enable'], ['POST', '/api/2fa/email/disable']]) {
    const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.ok(res.status === 401 || res.status === 503, path + ' ' + res.status);
  }
});

test('the monthly email: owner routes need sign-in, and a bad unsubscribe link changes nothing', async () => {
  for (const p of ['/api/admin/monthly-mail/test', '/api/admin/monthly-mail/send']) {
    const res = await fetch(BASE + p, { method: 'POST' });
    assert.ok(res.status === 401 || res.status === 503, p + ' ' + res.status);
  }
  const bad = await fetch(BASE + '/unsubscribe?u=x&t=y');
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /הקישור לא תקין/);
  const post = await fetch(BASE + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'u=x&t=y' });
  assert.equal(post.status, 400);
});

test("the owner's evening email runs only with the cron secret", async () => {
  const res = await fetch(BASE + '/api/admin/daily/run', { method: 'POST', headers: { 'X-Cron-Secret': 'wrong' } });
  assert.equal(res.status, 401);
});

test('request pictures: sending or seeing one needs a signed-in user', async () => {
  const up = await fetch(BASE + '/api/feedback/11111111-1111-1111-1111-111111111111/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":"x"}' });
  assert.ok(up.status === 401 || up.status === 503, String(up.status));
  const see = await fetch(BASE + '/api/feedback-image?p=11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png');
  assert.ok(see.status === 401 || see.status === 503, String(see.status));
});

test('the stop-these-emails link: a wrong one changes nothing', async () => {
  const bad = await fetch(BASE + '/unsubscribe?u=3f1c2b4a-1111-2222-3333-444455556666&t=' + 'a'.repeat(32) + '&k=news');
  assert.equal(bad.status, 400);
  const post = await fetch(BASE + '/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'u=x&t=y&k=news' });
  assert.equal(post.status, 400);
});

test('tell your friends: both endpoints need a signed-in person', async () => {
  assert.ok([401, 503].includes((await fetch(BASE + '/api/share')).status));
  const r = await fetch(BASE + '/api/share/joined', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ref":"a1b2c3"}' });
  assert.ok([401, 503].includes(r.status));
});

test('installed or not, everyone gets the same version: the service worker is versioned by the app\'s own files', async () => {
  const res = await fetch(BASE + '/sw.js');
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const sw = await res.text();
  assert.match(sw, /const CACHE = 'budget-app-[0-9a-f]{12}';/);
  assert.doesNotMatch(sw, /budget-app-dev/);
});

test('the advisor is told whether the person is on a phone or a computer', async () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'budget-ai-server.js'), 'utf8');
  assert.match(src, /devicePart\(device\)/);
  assert.match(src, /המשתמש כותב ממחשב/);
  assert.match(src, /המשתמש כותב מטלפון/);
});

test('faster loading: the app\'s files go out compressed, and the fonts come from this site', async () => {
  const js = await fetch(BASE + '/app/src/screens/advisor/AdvisorPanel.js', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(js.headers.get('content-encoding'), 'gzip');
  const shell = await (await fetch(BASE + '/app/')).text();
  assert.doesNotMatch(shell, /fonts\.googleapis/);
  assert.match(shell, /styles\/fonts\.css/);
  const font = await fetch(BASE + '/app/fonts/assistant-hebrew-400-normal.woff2');
  assert.equal(font.status, 200);
  assert.match(font.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(BASE + '/app/fonts/..%2Fpackage.json')).status, 404);
  const csp = (await fetch(BASE + '/app/')).headers.get('content-security-policy');
  assert.match(csp, /font-src 'self'/);
  assert.doesNotMatch(csp, /googleapis|gstatic/);
  for (const p of ['/privacy', '/terms', '/accessibility', '/security', '/download', '/delete-account']) assert.doesNotMatch(await (await fetch(BASE + p)).text(), /fonts\.g/, p);
});
