import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';

// Live prices for investments that have a symbol, through our own server
// (it fetches the quotes and the USD/ILS rate). Cached for 5 minutes.
const cache = new Map();

export function useMarket(symbols) {
  const key = symbols.slice().sort().join(',');
  const [state, setState] = useState(() => (cache.get(key) || {}).data || null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!key) { setState(null); return; }
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) { setState(hit.data); return; }
    let alive = true;
    api('/api/market/quotes?symbols=' + encodeURIComponent(key))
      .then((data) => { cache.set(key, { data, at: Date.now() }); if (alive) { setState(data); setError(null); } })
      .catch((err) => { if (alive) setError(err.message || 'market data unavailable'); });
    return () => { alive = false; };
  }, [key]);
  return { market: state, error };
}
