import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { money } from '../../domain/format.js';
import { tripSummary } from '../../domain/trips.js';
import { saveTrip, dismissTrip, openLater } from '../../data/trips.js';
import { showToast } from '../../lib/toast.js';
import { dateRange, newTrips } from './common.js';

// On the home screen: a trip just found in the card lines. One tap puts it
// in a folder (plans → trips); "not a trip" stops offering it.
export function TripFound({ data, trips }) {
  const [busy, setBusy] = useState(false);
  if (trips.status !== 'ready') return null;
  const found = newTrips(data.txs, trips.trips)[0];
  if (!found) return null;
  const s = tripSummary(found, 2);
  const act = async (fn, after) => {
    setBusy(true);
    try { await after(await fn(found)); } catch (_err) { showToast('לא נשמר. נסו שוב.'); } finally { setBusy(false); }
  };
  return html`<div class="card trip-found" role="region" aria-label="נמצא טיול">
    <div class="trip-found-head"><span class="trip-ic" aria-hidden="true">✈️</span>
      <span class="stack" style="gap:2px;min-width:0"><b>נראה שהייתם ${found.country ? 'ב' + found.country : 'בחו״ל'}</b>
        <span class="muted" style="font-size:14px;line-height:1.5">${dateRange(found.start, found.end)} · ${found.items.length} הוצאות · <span class="num">${money(s.total)}</span>. לאסוף אותן לתיקייה אחת?</span></span></div>
    <div class="trip-found-acts">
      <button type="button" class="btn" disabled=${busy} onClick=${() => act((f) => saveTrip(f, 2), (row) => { openLater(row.id); location.hash = '#/plans/trips'; })}>לפתוח תיקייה</button>
      <button type="button" class="btn-text" disabled=${busy} onClick=${() => act(dismissTrip, () => showToast('בסדר, זה לא טיול'))}>זה לא טיול</button>
    </div>
  </div>`;
}
