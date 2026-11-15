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
