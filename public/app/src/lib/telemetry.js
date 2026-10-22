import { sb } from './supabase.js';
import { CONFIG } from '../config.js';
import { readLocal, writeLocal } from './storage.js';

// What the app tells its owner, to fix what breaks and to know whether people
// come back: failures (message, stack, screen) and a few named actions
// ("added an expense"). Never what someone wrote, amounts or names. Sent in
// small batches; turning it off in the profile stops both. See /privacy.
const errors = [];
const events = [];
let timer = null;
let token = '';
const seen = new Set();

export const telemetryOn = () => readLocal('telemetry:off', '') !== '1';
export function setTelemetry(on) {
  writeLocal('telemetry:off', on ? '' : '1');
  if (!on) { errors.length = 0; events.length = 0; }
}

function soon() { if (!timer) timer = setTimeout(flush, 4000); }

export function track(name) {
  if (!telemetryOn()) return;
  events.push(name);
  soon();
}

export function reportError(err, where = '') {
  if (!telemetryOn()) return;
  const message = String((err && err.message) || err || 'error').slice(0, 300);
  const key = message + '|' + where;
  if (seen.has(key) || seen.size > 50) return; // each failure once per session
  seen.add(key);
  errors.push({ message, stack: String((err && err.stack) || '').slice(0, 3000), path: (where || location.hash || location.pathname).slice(0, 200) });
  soon();
}

export async function flush(final = false) {
  clearTimeout(timer); timer = null;
  if (!errors.length && !events.length) return;
  const ev = events.splice(0);
  const body = JSON.stringify({ errors: errors.splice(0), events: ev });
  if (!final) {
    try { const { data } = await sb.auth.getSession(); token = data?.session?.access_token || ''; } catch (_e) { /* anonymous */ }
  }
  try {
    await fetch(CONFIG.apiBase + '/api/telemetry', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body });
  } catch (_e) { /* offline: these are lost, that is fine */ }
}

// Unexpected failures anywhere in the app, and the last batch when leaving.
export function startTelemetry() {
  window.addEventListener('error', (e) => { if (e.error || e.message) reportError(e.error || e.message, 'window'); });
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
}
