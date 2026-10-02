import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcut, isTyping } from '../public/app/src/domain/shortcuts.js';

test('desktop shortcuts by physical key, whatever the keyboard layout', () => {
  assert.equal(shortcut({ code: 'KeyN' }), 'add');
  assert.equal(shortcut({ code: 'KeyU' }), 'import');
  assert.equal(shortcut({ code: 'Slash' }), 'advisor');
  assert.equal(shortcut({ code: 'Digit1' }), 'tab:home');
  assert.equal(shortcut({ code: 'Digit3' }), 'tab:together');
  assert.equal(shortcut({ code: 'Digit5' }), 'tab:assets');
  assert.equal(shortcut({ code: 'Digit9' }), null);
  assert.equal(shortcut({ code: 'KeyQ' }), null);
});

test('never while typing or with a modifier (those belong to the browser)', () => {
  assert.equal(shortcut({ code: 'KeyN', typing: true }), null);
  assert.equal(shortcut({ code: 'KeyN', ctrlKey: true }), null);
  assert.equal(shortcut({ code: 'KeyN', metaKey: true }), null);
  assert.equal(shortcut({ code: 'Digit1', altKey: true }), null);
  assert.equal(isTyping({ tagName: 'INPUT' }), true);
  assert.equal(isTyping({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTyping({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTyping({ tagName: 'BUTTON' }), false);
  assert.equal(isTyping(null), false);
});
