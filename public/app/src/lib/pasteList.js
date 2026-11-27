import { pastedList } from '../domain/shopping.js';

// A list of several lines pasted into the one-line "add" box: each line
// becomes one item (a one-line box would join them all into one). It goes
// where the cursor is, beside what was already typed.
export function pasteList(e, setText) {
  const text = e.clipboardData && e.clipboardData.getData('text');
  const list = pastedList(text);
  if (!list) return;
  e.preventDefault();
  const el = e.currentTarget;
  const cur = el.value || '';
  const a = el.selectionStart == null ? cur.length : el.selectionStart;
  const b = el.selectionEnd == null ? cur.length : el.selectionEnd;
  const before = cur.slice(0, a).replace(/[\s,]+$/, '');
  const after = cur.slice(b).replace(/^[\s,]+/, '');
  setText([before, list, after].filter(Boolean).join(', '));
}
