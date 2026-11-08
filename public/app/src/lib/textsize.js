// Bigger text for whoever needs it: the whole app grows (text, buttons and
// spacing together), so nothing breaks. Kept on this device.
import { writeLocal } from './storage.js';

export const TEXT_SIZES = [{ key: '', label: 'רגיל', zoom: 1 }, { key: 'l', label: 'גדול', zoom: 1.15 }, { key: 'xl', label: 'גדול מאוד', zoom: 1.3 }];

export function applyTextSize(key) {
  const s = TEXT_SIZES.find((x) => x.key === key) || TEXT_SIZES[0];
  document.documentElement.style.zoom = s.zoom === 1 ? '' : String(s.zoom);
  document.documentElement.dataset.text = s.key || 'normal';
}

export function setTextSize(key) {
  writeLocal('text:size', key);
  applyTextSize(key);
}
