import { useEffect, useState } from 'preact/hooks';
import { readLocal, writeLocal } from './storage.js';

// The owner can see the shopping tab as a regular family sees it (without
// the owner's trials), to try it out. Kept on this device only; nothing
// changes for anyone else, and the server still checks the owner as before.
const KEY = 'owner:shop-as-user';
const listeners = new Set();
export const shopAsUser = () => readLocal(KEY, '') === '1';
export function setShopAsUser(on) {
  writeLocal(KEY, on ? '1' : '');
  listeners.forEach((fn) => fn());
}
export function useShopAsUser() {
  const [on, setOn] = useState(shopAsUser);
  useEffect(() => { const fn = () => setOn(shopAsUser()); listeners.add(fn); return () => listeners.delete(fn); }, []);
  return on;
}

// Whether this person gets the shopping tab's full version: the owner, or
// someone in a household with him (asked of the server once, kept here so
// the tab does not blink on the next start). The server checks again on
// every shopping action.
export function useShopAccess(userId, owner) {
  const k = 'shop:access:' + (userId || '');
  const [on, setOn] = useState(() => readLocal(k, '') === '1');
  useEffect(() => {
    if (!userId || owner) return undefined;
    let live = true;
    import('./api.js').then(({ api }) => api('/api/shop/access')).then((r) => { if (!live) return; const yes = !!(r && r.shop); setOn(yes); writeLocal(k, yes ? '1' : ''); }).catch(() => {});
    return () => { live = false; };
  }, [userId, owner]);
  return owner || on;
}
