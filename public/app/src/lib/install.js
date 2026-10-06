import { installMode, isIOS, isMobile } from '../domain/install.js';
import { readLocal, writeLocal } from './storage.js';

// Installing the app on the device. Chrome and Edge offer their own install
// dialog through "beforeinstallprompt", which fires once, early: it is kept
// here (this module is loaded at startup) until the person asks to install.

let deferred = null;
let installed = false;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; emit(); });
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function env() {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints || 0;
  const standalone = installed || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  return { standalone, ios: isIOS(ua, touch), hasPrompt: !!deferred, mobile: isMobile(ua, touch) };
}

export const mode = () => installMode(env());

// Opens the browser's install dialog. true when the person accepted.
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  emit();
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  return !!choice && choice.outcome === 'accepted';
}

const KEY = 'install:dismissed';
export const dismissedAt = () => readLocal(KEY, '');
export function dismiss() { writeLocal(KEY, String(Date.now())); emit(); }
