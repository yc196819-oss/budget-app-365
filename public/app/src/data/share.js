import { api } from '../lib/api.js';
import { readLocal, writeLocal } from '../lib/storage.js';
import { refFrom } from '../domain/share.js';

// Kept from the friend's link until the new person has signed in.
const KEY = 'ref';
export function captureRef(search = location.search) {
  const r = refFrom(search);
  if (!r) return;
  writeLocal(KEY, r);
  // Off the address, so a reload does not count it again.
  try {
    const q = new URLSearchParams(location.search); q.delete('ref');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  } catch (_e) { /* ignore */ }
}

// Once, after signing in: tell the server who sent this person. The server
// counts it only for a new account, and never for oneself.
export async function claimRef() {
  const r = readLocal(KEY, '');
  if (!r) return;
  try { await api('/api/share/joined', { method: 'POST', body: { ref: r } }); } catch (_e) { return; }
  try { localStorage.removeItem(KEY); } catch (_e) { /* ignore */ }
}

// This person's code for their link, and how many friends joined with it.
export function myShare() {
  return api('/api/share');
}
