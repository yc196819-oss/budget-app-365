import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanCode, deviceName } from '../public/app/src/domain/security.js';

const ops = createRequire(import.meta.url)('../server/ops.js');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('the claims of a sign-in token: who, how strongly, which session', () => {
  const t = b64({ alg: 'HS256' }) + '.' + b64({ sub: 'u1', aal: 'aal2', session_id: 's1' }) + '.sig';
  assert.deepEqual(ops.tokenClaims(t), { sub: 'u1', aal: 'aal2', sessionId: 's1' });
  assert.deepEqual(ops.tokenClaims('junk'), { sub: null, aal: 'aal1', sessionId: null });
  assert.deepEqual(ops.tokenClaims(b64({}) + '.' + b64({ sub: 'u2' }) + '.s'), { sub: 'u2', aal: 'aal1', sessionId: null });
});

test('an email code: 6 digits, kept only as a hash, for 10 minutes and 5 tries', () => {
  for (let i = 0; i < 50; i++) assert.match(ops.makeCode(), /^\d{6}$/);
  const now = Date.parse('2026-11-03T10:00:00Z');
  const row = { code_hash: ops.hashCode('123456', 'u1', 'salt'), purpose: 'login', expires_at: new Date(now + 60000).toISOString(), attempts: 0 };
  const opt = { userId: 'u1', salt: 'salt', purpose: 'login', now };
  assert.notEqual(row.code_hash, '123456');
  assert.equal(ops.checkCode(row, '123456', opt), 'ok');
  assert.equal(ops.checkCode(row, ' 123 456 ', opt), 'ok', 'spaces typed with it do not matter');
  assert.equal(ops.checkCode(row, '654321', opt), 'wrong');
  assert.equal(ops.checkCode(row, '123456', { ...opt, userId: 'u2' }), 'wrong', 'a code is for one person only');
  assert.equal(ops.checkCode(row, '123456', { ...opt, purpose: 'enable' }), 'missing', 'a sign-in code does not turn it on');
  assert.equal(ops.checkCode(null, '123456', opt), 'missing');
  assert.equal(ops.checkCode({ ...row, attempts: ops.CODE_TRIES }, '123456', opt), 'locked');
  assert.equal(ops.checkCode(row, '123456', { ...opt, now: now + 61000 }), 'expired');
  assert.equal(ops.CODE_TTL_MS, 10 * 60 * 1000);
  for (const k of ['missing', 'expired', 'locked', 'wrong']) assert.ok(ops.CODE_ERRORS[k]);
});

test('the code email and the hidden address', () => {
  const m = ops.codeMail('042517', 'login');
  assert.match(m.subject, /042517/);
  assert.match(m.text, /042517/);
  assert.match(m.html, /dir="rtl"/);
  assert.match(ops.codeMail('1', 'enable').subject, /להפעלת/);
  assert.equal(ops.maskEmail('yossi@example.com'), 'yo***@example.com');
  assert.equal(ops.maskEmail('ab@x.com'), 'a*@x.com');
  assert.equal(ops.maskEmail(''), '');
});

test('what is typed in the code box, and the name of a signed-in device', () => {
  assert.equal(cleanCode(' 12-34 56 7'), '123456');
  assert.equal(cleanCode(null), '');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'), 'אנדרואיד · Chrome');
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Mobile Safari/604.1'), 'אייפון · Safari');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130'), 'מחשב Windows · Edge');
  assert.equal(deviceName(''), 'מכשיר');
});
