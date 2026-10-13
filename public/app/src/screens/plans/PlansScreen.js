import { html } from '../../lib/html.js';
import { Loading } from '../../components/Loading.js';
import { useState } from 'preact/hooks';
import { Segmented } from '../../components/Segmented.js';
import { routeView } from '../../domain/routes.js';
import { ComingMonths } from './ComingMonths.js';
import { BudgetGoals } from './BudgetGoals.js';
import { PlanSheets, usePlanSheet } from './PlanSheets.js';
import { TripsView } from '../trips/TripsView.js';
import { useTrips } from '../../data/useTrips.js';
import { openLater } from '../../data/trips.js';

const VIEWS = [{ key: 'months', label: 'החודשים הקרובים' }, { key: 'budget', label: 'תקציב ויעדים' }, { key: 'trips', label: 'טיולים' }];

export function PlansScreen({ data }) {
  const [view, setView] = useState(() => (VIEWS.some((v) => v.key === routeView(location.hash)) ? routeView(location.hash) : 'months'));
  const sheet = usePlanSheet();
  const trips = useTrips(data.hid);

  if (data.status === 'loading' || data.status === 'idle') return html`<${Loading} label="טוען…" />`;
  if (data.status === 'error') {
    return html`<div class="card empty" role="alert"><b style="color:var(--text)">לא הצלחנו לטעון את הנתונים</b><span>${data.error}</span>
      <button type="button" class="btn btn-ghost" onClick=${data.reload}>לנסות שוב</button></div>`;
  }
  return html`<div class="stack">
    <${Segmented} variant="tabs" label="תצוגה" value=${view} onChange=${setView} options=${VIEWS} />
    ${view === 'months' && html`<${ComingMonths} data=${data} onSheet=${sheet.open} onBudget=${() => setView('budget')} />`}
    ${view === 'budget' && html`<${BudgetGoals} data=${data} onTrip=${(id) => { openLater('goal:' + id); setView('trips'); }} />`}
    ${view === 'trips' && html`<${TripsView} data=${data} trips=${trips} />`}
    <${PlanSheets} data=${data} sheet=${sheet.value} onClose=${sheet.close} />
  </div>`;
}
