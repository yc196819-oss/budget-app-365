import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { HolidaySheet } from './HolidaySheet.js';
import { CheckinSheet } from './CheckinSheet.js';

// The holiday plan and the quarterly check-in open from Home and from Plans.
// One sheet at a time: { kind: 'holiday', holiday } | { kind: 'checkin' } | null
export function usePlanSheet() {
  const [value, setValue] = useState(null);
  return { value, open: setValue, close: () => setValue(null) };
}

export function PlanSheets({ data, sheet, onClose }) {
  if (!sheet) return null;
  if (sheet.kind === 'holiday') return html`<${HolidaySheet} data=${data} holiday=${sheet.holiday} onClose=${onClose} />`;
  if (sheet.kind === 'checkin') return html`<${CheckinSheet} data=${data} onClose=${onClose} />`;
  return null;
}
