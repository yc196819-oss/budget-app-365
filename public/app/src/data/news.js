import { api } from '../lib/api.js';
import { track } from '../lib/telemetry.js';

// Today's morning news (server: /api/news/today, one digest a day for all),
// kept on the device for the day so opening it again costs nothing.
export async function todaysNews(today) {
  track('news_open');
  const key = 'news:' + today;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && Array.isArray(cached.items)) return cached;
  } catch (_err) { /* no storage: ask the server */ }
  const { digest } = await api('/api/news/today');
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('news:') && k !== key).forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(key, JSON.stringify(digest));
  } catch (_err) { /* full or blocked */ }
  return digest;
}
