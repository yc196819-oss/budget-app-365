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
}
