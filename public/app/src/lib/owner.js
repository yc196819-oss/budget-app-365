import { useEffect, useState } from 'preact/hooks';
import { CONFIG } from '../config.js';

// Whether this person is the app's owner, by a fingerprint (SHA-256) of their
// email, so no owner's address is written in the public code. Only saves
// everyone else a request: the server checks again on every owner action.
const known = new Map();
export async function isOwnerEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !(globalThis.crypto && crypto.subtle)) return false;
  if (known.has(e)) return known.get(e);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(e));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const yes = CONFIG.ownerHashes.includes(hex);
  known.set(e, yes);
  return yes;
}
export function useOwner(email) {
  const [yes, setYes] = useState(() => known.get(String(email || '').trim().toLowerCase()) || false);
  useEffect(() => { let live = true; isOwnerEmail(email).then((v) => live && setYes(v)); return () => { live = false; }; }, [email]);
  return yes;
}
