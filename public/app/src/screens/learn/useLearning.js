import { useEffect, useState } from 'preact/hooks';
import { loadProgress } from '../../data/learning.js';
import { emptyProgress } from '../../domain/learning.js';

// Shared by the Home card and the learning sheet.
let cache = null;
const listeners = new Set();
export function setLearningCache(p) { cache = p; listeners.forEach((fn) => fn(p)); }

export function useLearning(userId) {
  const [progress, setProgress] = useState(cache || emptyProgress());
  const [ready, setReady] = useState(!!cache);
  useEffect(() => {
    const fn = (p) => { setProgress(p); setReady(true); };
    listeners.add(fn);
    if (!cache && userId) loadProgress(userId).then(setLearningCache);
    return () => listeners.delete(fn);
  }, [userId]);
  return { progress, ready };
}
