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

// A recipe shared from the phone, on its way to "the advisor fills a cart":
// { text } or { file }. In memory only.
let recipeWaiting = null;
export function sendRecipe(r) { recipeWaiting = r; try { window.dispatchEvent(new CustomEvent('recipe-shared')); } catch (_e) { /* tests */ } }
export function takeRecipe() { const r = recipeWaiting; recipeWaiting = null; return r; }
