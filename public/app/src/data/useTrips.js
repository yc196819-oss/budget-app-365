import { useEffect, useState } from 'preact/hooks';
import { load, snapshot, subscribe } from './trips.js';

// The household's trip folders, loaded once per household.
export function useTrips(hid) {
  const [data, setData] = useState(snapshot);
  useEffect(() => subscribe(() => setData(snapshot())), []);
  useEffect(() => { if (hid && snapshot().hid !== hid) load(hid); }, [hid]);
  return data;
}
