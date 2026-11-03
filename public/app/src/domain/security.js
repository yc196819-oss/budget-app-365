// Pure helpers for the two-step login and the "your security" screen.

export function cleanCode(code) { return String(code || '').replace(/\D/g, '').slice(0, 6); }

// "Chrome on Android", from the browser's own description.
export function deviceName(ua) {
  const s = String(ua || '');
  const os = /iPhone|iPad/.test(s) ? 'אייפון' : /Android/.test(s) ? 'אנדרואיד' : /Windows/.test(s) ? 'מחשב Windows' : /Mac OS X|Macintosh/.test(s) ? 'מחשב Mac' : /Linux/.test(s) ? 'מחשב Linux' : 'מכשיר';
  const br = /Edg\//.test(s) ? 'Edge' : /SamsungBrowser/.test(s) ? 'Samsung' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return br ? os + ' · ' + br : os;
}
