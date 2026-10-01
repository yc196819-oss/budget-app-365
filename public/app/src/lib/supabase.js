import { CONFIG } from '../config.js';

// The UMD build is loaded by index.html from /app/vendor/supabase.js.
const { createClient } = window.supabase;

export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
