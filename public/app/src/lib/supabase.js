import { CONFIG } from '../config.js';

// The UMD build is loaded by index.html from /app/vendor/supabase.js.
const { createClient } = window.supabase;

// The demo tab (the owner opened the demo household from the owner's
// screen): its own session, kept in this tab only, so the owner stays signed
// in to their own account everywhere else. The session comes in the address
// after "#demo=" once, and is taken out of the address at once.
const DEMO_KEY = 'sb-demo-auth';
export const IS_DEMO = new URLSearchParams(location.search).get('demo') === '1';
if (IS_DEMO && location.hash.startsWith('#demo=')) {
  try {
    const raw = location.hash.slice(6).replace(/-/g, '+').replace(/_/g, '/');
    const session = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (session && session.access_token && session.refresh_token) sessionStorage.setItem(DEMO_KEY, JSON.stringify(session));
  } catch (_e) { /* a broken link: the tab simply shows the sign-in */ }
  history.replaceState(null, '', location.pathname + location.search + '#/home');
}

export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: IS_DEMO
    ? { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: DEMO_KEY, storage: window.sessionStorage }
    : { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
