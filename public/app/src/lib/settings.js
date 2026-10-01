import { readLocal, writeLocal } from './storage.js';

// Per-device switches. When the advisor is off, nothing is sent to the AI
// from the new app (not the advisor, and not the merchant suggestions of
// the statement import).
const listeners = new Set();
export const aiEnabled = () => readLocal('ai:off', '') !== '1';
export function setAiEnabled(on) {
  writeLocal('ai:off', on ? '' : '1');
  listeners.forEach((fn) => fn());
}
export function subscribeSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
