import { sb } from '../lib/supabase.js';
import { CONFIG } from '../config.js';

// The rate of a currency for a date (Bank of Israel representative rate, or
// the last one before it), from our server. Remembered per session.
const cache = new Map();

export async function getRate(currency, date) {
  const key = currency + ':' + date;
  if (cache.has(key)) return cache.get(key);
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  const res = await fetch(CONFIG.apiBase + '/api/fx/rate?currency=' + encodeURIComponent(currency) + '&date=' + encodeURIComponent(date), { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !(j.rate > 0)) throw new Error(j.error || 'לא הצלחנו להביא שער. אפשר להקליד את הסכום בשקלים.');
  cache.set(key, j);
  return j;
}
