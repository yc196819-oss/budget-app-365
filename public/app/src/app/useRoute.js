import { useEffect, useState } from 'preact/hooks';
import { parseRoute } from '../domain/routes.js';

export function useRoute() {
  const [tab, setTab] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setTab(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    // The hash may have changed while the app was starting, before this listener.
    on();
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return tab;
}
