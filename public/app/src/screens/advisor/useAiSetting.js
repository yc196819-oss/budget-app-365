import { useEffect, useState } from 'preact/hooks';
import { aiEnabled, subscribeSettings } from '../../lib/settings.js';

export function useAiSetting() {
  const [on, setOn] = useState(aiEnabled);
  useEffect(() => subscribeSettings(() => setOn(aiEnabled())), []);
  return on;
}
