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
