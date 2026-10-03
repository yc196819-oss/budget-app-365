// One toast at a time, optionally with an action ("ביטול" by default).
let current = null;
const listeners = new Set();
let timer = null;

function emit() { listeners.forEach((fn) => fn(current)); }

export function showToast(message, { undo = null, ms, label = 'ביטול' } = {}) {
  clearTimeout(timer);
  current = { id: Date.now(), message, undo, label };
  emit();
  timer = setTimeout(hideToast, ms || (undo ? 5000 : 2600));
}

export function hideToast() {
  clearTimeout(timer);
  current = null;
  emit();
}

export function subscribeToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
