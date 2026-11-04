import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareLink, shareText, shareTargets, refFrom } from '../public/app/src/domain/share.js';

test('tell your friends: a link with the code, a ready message, WhatsApp and email', () => {
  const link = shareLink('https://app.example/', 'a1b2c3');
  assert.equal(link, 'https://app.example/app/?ref=a1b2c3');
  assert.equal(shareLink('https://app.example', 'nope'), 'https://app.example/app/', 'no code, no ref');
  const t = shareText(link);
  assert.match(t, /התקציב שלנו/);
  assert.match(t, /בחינם/);
  assert.ok(t.trim().endsWith(link), 'the link is last, so it shows as a link');
  const g = shareTargets(link);
  assert.ok(g.whatsapp.startsWith('https://wa.me/?text='));
  assert.equal(decodeURIComponent(g.whatsapp.split('text=')[1]), t);
  assert.ok(g.email.startsWith('mailto:?subject='));
  assert.match(decodeURIComponent(g.email), /ref=a1b2c3/);
});

test('arriving from a friend: only a valid code is kept', () => {
  assert.equal(refFrom('?ref=a1b2c3'), 'a1b2c3');
  assert.equal(refFrom('?ref=A1B2C3'), null);
  assert.equal(refFrom('?ref=<script>'), null);
  assert.equal(refFrom(''), null);
  assert.equal(refFrom('?go=import&ref=00ff00'), '00ff00');
});
