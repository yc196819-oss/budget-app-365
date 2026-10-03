// localStorage can throw (private mode, blocked storage), so every access is guarded.
export function readLocal(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (_err) {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try { localStorage.setItem(key, value); } catch (_err) { /* ignore */ }
}

// Keys that must not stay on a shared device after logout.
// The current app writes some of these too, and the same list is cleared there.
export const SENSITIVE_KEYS = ['geminiKey', 'aiApiBase'];

export function clearSensitiveLocal() {
  SENSITIVE_KEYS.forEach((k) => {
    try { localStorage.removeItem(k); } catch (_err) { /* ignore */ }
  });
  // The household data kept for an instant start (see readCache) goes too.
  try { Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch (_err) { /* ignore */ }
}

// The last data seen, so the app opens with it at once and refreshes in the
// background. Kept only on this device, removed on sign-out.
const CACHE_PREFIX = 'cache:';
export function readCache(key) {
  try { const v = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null'); return v && v.data ? v : null; } catch (_err) { return null; }
}
export function writeCache(key, data) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data })); } catch (_err) { /* full or blocked: just no instant start */ }
}
