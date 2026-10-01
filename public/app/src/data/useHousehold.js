import { useEffect, useState } from 'preact/hooks';
import { load, snapshot, subscribe } from './household.js';

export function useHousehold(hid, userId) {
  const [data, setData] = useState(snapshot);
  useEffect(() => subscribe(() => setData(snapshot())), []);
  useEffect(() => { load(hid, userId); }, [hid, userId]);
  return { ...data, reload: () => load(hid, userId, { force: true }) };
}
