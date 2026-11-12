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

// "Still here", once a minute while the app is on screen: how many are
// online now, on which screen and kind of device (for the owner's live
// count). A random id for this device, never who it is or what is shown.
let screenName = '';
export function setScreen(name) { screenName = name; }
function visitorId() {
  let v = readLocal('visitor', '');
  if (!/^[\w-]{8,40}$/.test(v)) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); writeLocal('visitor', v); }
  return v;
}
// What a person opens the app on: a computer, a phone's browser, or the app
// installed on the phone. Only the kind of device, nothing else about it.
export function deviceKind() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) return 'installed';
  return matchMedia('(min-width: 900px)').matches ? 'desktop' : 'mobile';
}
export async function beat() {
  if (!telemetryOn() || document.visibilityState !== 'visible') return;
  const tab = String(location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  const body = JSON.stringify({
    v: visitorId(),
    screen: screenName || tab || 'home',
    device: matchMedia('(min-width: 900px)').matches ? 'desktop' : 'mobile',
    installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  });
  let auth = {};
  try { const { data } = await sb.auth.getSession(); if (data?.session?.access_token) auth = { Authorization: 'Bearer ' + data.session.access_token }; } catch (_e) { /* anonymous */ }
  try { await fetch(CONFIG.apiBase + '/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body }); } catch (_e) { /* offline */ }
}

// Unexpected failures anywhere in the app, and the last batch when leaving.
export function startTelemetry() {
  setTimeout(beat, 3000);
  setInterval(beat, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
  window.addEventListener('error', (e) => { if (e.error || e.message) reportError(e.error || e.message, 'window'); });
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
}
