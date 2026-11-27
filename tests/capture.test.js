const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newKey, hashKey, keyFrom, readBody, fingerprint, parseWallet } = require('../server/capture');

test('a new key is long and random, and only its hash is kept', () => {
  const a = newKey();
  const b = newKey();
  assert.match(a, /^bk_[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, b);
  assert.equal(hashKey(a), hashKey(a));
  assert.notEqual(hashKey(a), hashKey(b));
  assert.doesNotMatch(hashKey(a), /bk_/);
});

test('the key is read from the header with or without "Bearer"', () => {
  const k = newKey();
  assert.equal(keyFrom('Bearer ' + k), k);
  assert.equal(keyFrom(k), k);
  assert.equal(keyFrom(''), null);
  assert.equal(keyFrom('Bearer eyJhbGciOi.session.token'), null, 'a login token is not a phone key');
  assert.equal(keyFrom('bk_short'), null);
});

test('the body: title and text, cleaned and cut; empty is nothing', () => {
  assert.deepEqual(readBody({ title: ' סופר  השכונה ', text: '‏₪45.90 עם כרטיס', extra: 'x' }), { app: '', title: 'סופר השכונה', text: '₪45.90 עם כרטיס' });
  assert.equal(readBody({ text: 'x'.repeat(900) }).text.length, 500);
  assert.equal(readBody({}), null);
  assert.equal(readBody(null), null);
});

test('plain text: the title on the first line, quotes and & arrive whole', () => {
  assert.deepEqual(readBody('דוגמה בע"מ\n₪12.00 עם כרטיס •••• 4821\nשורה שנייה'), { app: '', title: 'דוגמה בע"מ', text: '₪12.00 עם כרטיס •••• 4821 שורה שנייה' });
  assert.deepEqual(readBody('A&B'), { app: '', title: '', text: 'A&B' });
  assert.equal(readBody(''), null);
});

test('the same notification in the same minute has one fingerprint', () => {
  const n = { title: 'קפה', text: '₪12.00' };
  assert.equal(fingerprint('h1', n, '2026-11-27T10:00:05Z'), fingerprint('h1', n, '2026-11-27T10:00:50Z'));
  assert.notEqual(fingerprint('h1', n, '2026-11-27T10:00:05Z'), fingerprint('h1', n, '2026-11-27T10:01:05Z'));
  assert.notEqual(fingerprint('h1', n, '2026-11-27T10:00:05Z'), fingerprint('h2', n, '2026-11-27T10:00:05Z'));
});

test('a Wallet notification in English: amount, merchant, card', () => {
  assert.deepEqual(parseWallet({ title: 'Corner Market', text: '₪45.90 with Mastercard •••• 4821' }), { amount: 45.9, currency: 'ILS', merchant: 'Corner Market', last4: '4821' });
  assert.deepEqual(parseWallet({ title: 'Book Shop', text: '$1,204.50 with Visa ••4821' }), { amount: 1204.5, currency: 'USD', merchant: 'Book Shop', last4: '4821' });
});

test('in Hebrew, with direction marks and the sign after the number', () => {
  assert.deepEqual(parseWallet({ title: 'מאפיית הכיכר 12', text: '‏45.90 ₪ באמצעות Mastercard ‎•••• 4821' }), { amount: 45.9, currency: 'ILS', merchant: 'מאפיית הכיכר 12', last4: '4821' });
  assert.deepEqual(parseWallet({ title: 'תחנת דלק', text: 'שולמו 200 ש"ח בכרטיס 4821' }), { amount: 200, currency: 'ILS', merchant: 'תחנת דלק', last4: '4821' });
});

test('when the title is the app, the merchant comes from the text', () => {
  const p = parseWallet({ title: 'Google Wallet', text: 'Paid ₪30.00 at Pizza Place with Visa •••• 4821' });
  assert.equal(p.merchant, 'Pizza Place with Visa');
  assert.equal(p.amount, 30);
  assert.equal(parseWallet({ title: '₪30.00', text: 'ב-מכולת' }).merchant, 'מכולת');
});

test('what is not there stays empty', () => {
  assert.deepEqual(parseWallet({ title: 'Wallet', text: 'הכרטיס נוסף בהצלחה' }), { amount: null, currency: null, merchant: null, last4: null });
  assert.equal(parseWallet({ title: 'x', text: '₪0.00' }).amount, null);
});
