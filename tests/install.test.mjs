import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMode, showInstallCard, isIOS, isMobile, SNOOZE_DAYS } from '../public/app/src/domain/install.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

test('devices: iPhone, iPad (that says Macintosh but has touch), Android, desktop', () => {
  assert.ok(isIOS(IPHONE) && isMobile(IPHONE));
  assert.ok(isIOS(IPAD_DESKTOP_UA, 5), 'iPadOS asks for the desktop site');
  assert.ok(!isIOS(IPAD_DESKTOP_UA, 0), 'a real Mac is not iOS');
  assert.ok(!isIOS(ANDROID) && isMobile(ANDROID));
  assert.ok(!isMobile(WINDOWS));
});

test('how to install: nothing when installed, the browser dialog when offered, steps otherwise', () => {
  assert.equal(installMode({ standalone: true, ios: true, hasPrompt: true, mobile: true }), 'hidden');
  assert.equal(installMode({ standalone: false, ios: false, hasPrompt: true, mobile: true }), 'prompt');
  assert.equal(installMode({ standalone: false, ios: false, hasPrompt: true, mobile: false }), 'prompt', 'desktop Chrome can install too');
  assert.equal(installMode({ standalone: false, ios: true, hasPrompt: false, mobile: true }), 'ios');
  assert.equal(installMode({ standalone: false, ios: false, hasPrompt: false, mobile: true }), 'manual');
  assert.equal(installMode({ standalone: false, ios: false, hasPrompt: false, mobile: false }), 'hidden');
});

test('the home card: phones not yet installed, back 14 days after "not now"', () => {
  const phone = { standalone: false, ios: true, hasPrompt: false, mobile: true };
  const now = Date.UTC(2026, 9, 6);
  assert.equal(showInstallCard(phone, '', now), true);
  assert.equal(showInstallCard(phone, String(now - 86400000), now), false);
  assert.equal(showInstallCard(phone, String(now - SNOOZE_DAYS * 86400000), now), true);
  assert.equal(showInstallCard({ ...phone, standalone: true }, '', now), false);
  assert.equal(showInstallCard({ standalone: false, ios: false, hasPrompt: true, mobile: false }, '', now), false, 'not on desktop');
});
