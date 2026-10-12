import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { money, shortDate } from '../../domain/format.js';
import { tripSummary } from '../../domain/trips.js';
import { takeOpen } from '../../data/trips.js';
import { TripFound } from './TripFound.js';
import { TripSheet } from './TripSheet.js';
import { PlanTripSheet } from './PlanTripSheet.js';
import { COLORS, CAT_LIST, dateRange, categoryNamer, folderTrip } from './common.js';

// Plans → trips: the folders of past trips, the trips planned (goals with ✈️),
// and planning the next one.
export function TripsView({ data, trips }) {
  // { kind: 'trip', id } | { kind: 'plan', id: base trip id | null } | null
  const [sheet, setSheet] = useState(null);
  useEffect(() => { const id = takeOpen(); if (id) setSheet({ kind: 'trip', id }); }, [trips.trips.length]);
  if (trips.missing) return html`<div class="card muted">הטיולים יופיעו כאן אחרי עדכון של מסד הנתונים.</div>`;
  const saved = trips.trips.filter((t) => t.status === 'saved');
  const planned = (data.goals || []).filter((g) => g.icon === '✈️');
  const catName = categoryNamer(data.categories);
  const row = sheet && sheet.id ? saved.find((t) => t.id === sheet.id) : null;

  return html`<div class="stack">
    <${TripFound} data=${data} trips=${trips} />
    <button type="button" class="btn" onClick=${() => setSheet({ kind: 'plan', id: saved[0] ? saved[0].id : null })}>✈️ לתכנן טיול</button>
    ${planned.length > 0 && html`<section class="stack" style="gap:8px"><h2 class="section-h">מתוכנן</h2>
      <div class="list">${planned.map((g) => html`<div class="row" key=${g.id}><span class="cat-icon" style="background:var(--surface-2)" aria-hidden="true">✈️</span>
        <span class="row-main"><b>${g.name}</b><span>${g.target_date ? shortDate(g.target_date) + ' · ' : ''}${money(g.saved_amount || 0)} מתוך ${money(g.target_amount)} · בתחזית</span></span>
        <b class="amt num">${money(g.target_amount)}</b></div>`)}</div></section>`}
    <section class="stack" style="gap:8px"><h2 class="section-h">טיולים שהיו</h2>
      ${saved.length === 0
        ? html`<div class="card muted" style="font-size:14px">כשתעלו פירוט אשראי עם טיול, הוא יזוהה לבד ויופיע כאן עם כל ההוצאות שלו.</div>`
        : saved.map((r) => {
          const s = tripSummary(folderTrip(r, data.txs), r.people, new Set(r.excluded_ids || []), catName);
          const parts = CAT_LIST.filter(([k]) => s.by[k] > 0).sort((a, b) => s.by[b[0]] - s.by[a[0]]);
          return html`<button type="button" class="card trip-card" key=${r.id} onClick=${() => setSheet({ kind: 'trip', id: r.id })}>
            <span class="trip-card-head"><span class="trip-ic" aria-hidden="true">🧳</span>
              <span class="row-main"><b>${r.name}</b><span>${dateRange(r.start_date, r.end_date)} · ${money(s.perDay)} ליום</span></span>
              <b class="num">${money(s.total)}</b></span>
            ${s.total > 0 && html`<span class="trip-mini">${parts.map(([k]) => html`<i style=${'width:' + (s.by[k] / s.total * 100).toFixed(1) + '%;background:' + COLORS[k]}></i>`)}</span>
            <span class="trip-legend">${parts.slice(0, 4).map(([k, c]) => html`<span style=${'--c:' + COLORS[k]}>${c.label}</span>`)}</span>`}
          </button>`;
        })}
    </section>
    ${sheet && sheet.kind === 'trip' && row && html`<${TripSheet} row=${row} data=${data} onPlan=${() => setSheet({ kind: 'plan', id: row.id })} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.kind === 'plan' && html`<${PlanTripSheet} data=${data} row=${row} onClose=${() => setSheet(null)} />`}
  </div>`;
}
