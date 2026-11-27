// Desktop keyboard shortcuts. By physical key (event.code), so they work the
// same with a Hebrew or an English layout. Never while typing or with a
// modifier held (those belong to the browser). Pure.

import { TABS } from './routes.js';

export const SHORTCUTS = { KeyN: 'add', KeyU: 'import', Slash: 'advisor' };

export function shortcut({ code, ctrlKey, metaKey, altKey, typing }) {
  if (typing || ctrlKey || metaKey || altKey) return null;
  if (SHORTCUTS[code]) return SHORTCUTS[code];
  const m = /^Digit([1-9])$/.exec(code || '');
  if (m && TABS[Number(m[1]) - 1]) return 'tab:' + TABS[Number(m[1]) - 1].key;
  return null;
}

export function isTyping(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
}

// In a shopping list on a computer: A jumps to the box that adds items, the
// arrows move between the items (Space, the browser's own, checks one).
// Not while typing in a text box; a checked box (an item) is not typing.
export function shopShortcut({ code, ctrlKey, metaKey, altKey, typing, onItem }) {
  if (ctrlKey || metaKey || altKey) return null;
  if (typing && !onItem) return null;
  if (code === 'KeyA') return 'add';
  if (code === 'ArrowDown') return 'next';
  if (code === 'ArrowUp') return 'prev';
  return null;
}
