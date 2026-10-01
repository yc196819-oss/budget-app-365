import { useEffect, useState } from 'preact/hooks';
import { load, snapshot, subscribe } from './decisions.js';

// Shared decisions of the household, refreshed when the app comes back to the
// foreground (the partner may have answered on their phone).
export function useDecisions(hid) {
  const [data, setData] = useState(snapshot);
  useEffect(() => subscribe(() => setData(snapshot())), []);
  useEffect(() => {
    if (!hid) return undefined;
    load(hid);
    const onVisible = () => { if (document.visibilityState === 'visible') load(hid); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [hid]);
  return { ...data, reload: () => load(hid) };
}
