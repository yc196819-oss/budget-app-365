// When signing in with Google comes back with an error in the address
// (?error=... or #error=...), a plain sentence for the sign-in screen, or ''.
// "bad_oauth_state": the sign-in took too long, or was started in another
// tab, so its safety check no longer matched. Starting over fixes it. Pure.
export function oauthErrorText(search = '', hash = '') {
  const read = (s) => new URLSearchParams(String(s || '').replace(/^[?#]/, ''));
  const q = read(search), h = read(hash);
  const code = q.get('error_code') || h.get('error_code') || q.get('error') || h.get('error') || '';
  if (!code) return '';
  if (/bad_oauth_state|flow_state|expired/i.test(code + ' ' + (q.get('error_description') || h.get('error_description') || ''))) {
    return 'הכניסה עם Google לקחה יותר מדי זמן, או נפתחה בחלון אחר, ולכן לא הושלמה. לחצו שוב על "כניסה עם Google" ותאשרו בתוך כמה דקות.';
  }
  if (/access_denied/i.test(code)) return 'הכניסה עם Google בוטלה. אפשר לנסות שוב, או להיכנס עם אימייל.';
  return 'הכניסה עם Google לא הושלמה. נסו שוב, או היכנסו עם אימייל.';
}
