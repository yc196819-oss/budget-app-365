import { CONFIG } from '../config.js';
import { sb } from './supabase.js';

// Calls our own server with the user's session token. The server verifies
// the token (requireAuth) before touching any data.
export async function api(path, { method = 'GET', body } = {}) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  const res = await fetch(CONFIG.apiBase + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'request failed (' + res.status + ')');
  return json;
}
