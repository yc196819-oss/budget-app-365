import { sb } from './supabase.js';
import { CONFIG } from '../config.js';

// Push notifications on this device: the same service worker (/sw.js) and the
// same push_subscriptions table the previous version uses, so a phone that
// already allowed notifications there keeps getting them.

// The worker keeps the app's files on the device so it opens at once; when a
// new version arrives in the background, offer to switch to it.
export function registerWorker(onUpdate) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'app-updated' && onUpdate) onUpdate();
    if (e.data && e.data.type === 'open') openInApp(e.data.url);
  });
}

// A tapped notification, while the app is open: go to its screen. An action
// (?action=ask) or a view inside the tab already showing needs a fresh load,
// so the screen opens in that state; another tab is just a hash change.
export function openInApp(url) {
  let u;
  try { u = new URL(url, location.origin); } catch (_e) { return; }
  if (u.origin !== location.origin) return;
  const tabOf = (h) => String(h || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  if (u.search || u.pathname !== location.pathname) { location.assign(u.href); return; }
  if (tabOf(u.hash) === tabOf(location.hash)) { location.hash = u.hash; location.reload(); return; }
  location.hash = u.hash || '#/home';
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'on' | 'off' | 'denied' | 'install' (iPhone: add to home screen first) | 'unsupported'
export async function pushState() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIOS() && !standalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg && (await reg.pushManager.getSubscription()) ? 'on' : 'off';
  } catch (_err) { return 'off'; }
}

function keyBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush({ userId, hid }) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'ההרשאה נחסמה. אפשר לאפשר התראות לאתר בהגדרות הדפדפן.' : 'ההרשאה לא אושרה.');
  const res = await fetch(CONFIG.apiBase + '/api/push/vapid-public-key');
  if (!res.ok) throw new Error('שירות ההתראות לא זמין כרגע.');
  const { publicKey } = await res.json();
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const raw = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ user_id: userId, household_id: hid, endpoint: raw.endpoint, p256dh: raw.keys.p256dh, auth: raw.keys.auth }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
