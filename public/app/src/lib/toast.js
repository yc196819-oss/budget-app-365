// One toast at a time, optionally with an undo action.
let current = null;
const listeners = new Set();
let timer = null;

function emit() { listeners.forEach((fn) => fn(current)); }

export function showToast(message, { undo = null, ms } = {}) {
  clearTimeout(timer);
  current = { id: Date.now(), message, undo };
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
