import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { CATS, category, tripSummary } from '../../domain/trips.js';
import { updateTrip, deleteTrip } from '../../data/trips.js';
import { showToast } from '../../lib/toast.js';
import { COLORS, CAT_LIST, dateRange, categoryNamer, folderTrip } from './common.js';

// A trip's folder: what it cost, per day and per person, where the money
// went, and every line (one tap leaves a line out). From here: plan the next.
export function TripSheet({ row, data, onPlan, onClose }) {
  const [sure, setSure] = useState(false);
  const trip = folderTrip(row, data.txs);
  const catName = categoryNamer(data.categories);
  const excluded = new Set(row.excluded_ids || []);
  const s = tripSummary(trip, row.people, excluded, catName);
  const max = Math.max(1, ...Object.values(s.by));
  const save = (patch) => updateTrip(row.id, patch).catch(() => showToast('לא נשמר. נסו שוב.'));
  const toggle = (id) => save({ excluded_ids: excluded.has(id) ? [...excluded].filter((x) => x !== id) : [...excluded, id] });
  const remove = async () => {
    if (!sure) { setSure(true); return; }
    try { await deleteTrip(row.id); onClose(); showToast('התיקייה נמחקה. ההוצאות עצמן נשארו.'); } catch (_err) { showToast('המחיקה נכשלה. נסו שוב.'); }
  };
  const before = trip.items.filter((t) => t.when === 'before'), during = trip.items.filter((t) => t.when !== 'before');
  const sum = (l) => money(l.filter((t) => !excluded.has(t.id)).reduce((a, t) => a + Number(t.amount), 0));
  const line = (t) => {
    const c = CATS[category(t.description, catName(t))];
    const off = excluded.has(t.id);
    return html`<label class=${'row trip-line' + (off ? ' off' : '')} key=${t.id}>
      <input type="checkbox" checked=${!off} onChange=${() => toggle(t.id)} aria-label="לכלול בטיול" />
      <span class="cat-icon" style="background:var(--surface-2)" aria-hidden="true">${c.icon}</span>
      <span class="row-main"><b class="ltr-name">${t.description}</b><span>${+t.tx_date.slice(8, 10)}.${+t.tx_date.slice(5, 7)} · ${c.label}</span></span>
      <b class="amt num">${money(t.amount)}</b></label>`;
  };
  return html`<${Sheet} title=${row.name} onClose=${onClose} full=${true}>
    <div class="card trip-hero">
      <span class="muted">${dateRange(row.start_date, row.end_date)}</span>
      <b class="trip-total num">${money(s.total)}</b>
      <div class="trip-stats">
        <div><b class="num">${s.days}</b><span>ימים</span></div>
        <div><b class="num">${money(s.perDay)}</b><span>ליום</span></div>
        <div><b class="num">${money(s.perPerson)}</b><span>לאדם</span></div>
      </div>
      <div class="sec-row"><span class="muted">כמה נסעו</span>
        <span class="stepper"><button type="button" aria-label="פחות" disabled=${row.people <= 1} onClick=${() => save({ people: row.people - 1 })}>−</button><b class="num">${row.people}</b><button type="button" aria-label="יותר" onClick=${() => save({ people: row.people + 1 })}>+</button></span></div>
    </div>
    <div class="card stack" style="gap:10px"><b>לאן הלך הכסף</b>
      ${CAT_LIST.filter(([k]) => s.by[k] > 0).sort((a, b) => s.by[b[0]] - s.by[a[0]]).map(([k, c]) => html`<div class="trip-bar" key=${k}>
        <span aria-hidden="true">${c.icon}</span><span>${c.label}</span><b class="num">${money(s.by[k])}</b>
        <span class="bar"><span style=${'width:' + (s.by[k] / max * 100).toFixed(1) + '%;background:' + COLORS[k]}></span></span></div>`)}
    </div>
    ${before.length > 0 && html`<b>הוזמן מראש · <span class="num">${sum(before)}</span></b><div class="list">${before.map(line)}</div>`}
    <b>בזמן הטיול · <span class="num">${sum(during)}</span></b>
    <div class="list">${during.map(line)}</div>
    <p class="faint" style="font-size:13px;margin:0">הוצאה ששויכה בטעות? מורידים את הסימון והיא יוצאת מהחישוב.</p>
    <button type="button" class="btn" onClick=${onPlan}>✈️ לתכנן את הטיול הבא לפי הטיול הזה</button>
    <button type="button" class="btn-text" style="color:var(--danger);align-self:flex-start" onClick=${remove}>${sure ? 'כן, למחוק את התיקייה' : 'למחוק את התיקייה'}</button>
  <//>`;
}
