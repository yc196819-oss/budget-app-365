// Pure helpers for the two-step login and the "your security" screen.

export function cleanCode(code) { return String(code || '').replace(/\D/g, '').slice(0, 6); }

// "Chrome on Android", from the browser's own description.
export function deviceName(ua) {
  const s = String(ua || '');
  const os = /iPhone|iPad/.test(s) ? 'אייפון' : /Android/.test(s) ? 'אנדרואיד' : /Windows/.test(s) ? 'מחשב Windows' : /Mac OS X|Macintosh/.test(s) ? 'מחשב Mac' : /Linux/.test(s) ? 'מחשב Linux' : 'מכשיר';
  const br = /Edg\//.test(s) ? 'Edge' : /SamsungBrowser/.test(s) ? 'Samsung' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return br ? os + ' · ' + br : os;
}

// Sending the email code again: allowed once a minute has passed.
export const RESEND_AFTER_S = 60;
export function secondsLeft(sentAt, now = Date.now(), wait = RESEND_AFTER_S) {
  if (!sentAt) return 0;
  return Math.min(wait, Math.max(0, Math.ceil(wait - (now - sentAt) / 1000)));
}
// 42 -> "0:42"
export function clock(sec) {
  const s = Math.max(0, Math.round(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
