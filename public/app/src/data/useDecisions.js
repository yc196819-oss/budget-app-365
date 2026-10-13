import { useEffect, useState } from 'preact/hooks';
import { load, snapshot, subscribe, live } from './decisions.js';

// Shared decisions of the household: live while the app is open, and loaded
// again when it comes back to the foreground.
export function useDecisions(hid, userId) {
  const [data, setData] = useState(snapshot);
  useEffect(() => subscribe(() => setData(snapshot())), []);
  useEffect(() => {
    if (!hid) return undefined;
    load(hid);
    const onVisible = () => { if (document.visibilityState === 'visible') load(hid); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [hid]);
  // Live: messages, reads, "typing…" and answers from the other phone.
  useEffect(() => (hid && userId ? live(hid, userId) : undefined), [hid, userId]);
  return { ...data, reload: () => load(hid) };
}
