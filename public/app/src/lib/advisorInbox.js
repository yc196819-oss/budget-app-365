// A picture on its way to the advisor (shared from the phone): kept in
// memory only, until the advisor's panel takes it. Never stored.
let waiting = null;

export function sendToAdvisor(file) {
  waiting = file;
  try { window.dispatchEvent(new CustomEvent('advisor-image')); } catch (_e) { /* no window: tests */ }
}

export function takeAdvisorImage() {
  const f = waiting;
  waiting = null;
  return f;
}
