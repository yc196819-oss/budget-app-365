import { html } from '../../lib/html.js';
import { Loading } from '../../components/Loading.js';
import { useEffect, useState } from 'preact/hooks';
import { Segmented } from '../../components/Segmented.js';
import { routeView } from '../../domain/routes.js';
import { ComingMonths } from './ComingMonths.js';
import { BudgetGoals } from './BudgetGoals.js';
import { PlanSheets, usePlanSheet } from './PlanSheets.js';
import { TripsView } from '../trips/TripsView.js';
import { useTrips } from '../../data/useTrips.js';
import { openLater } from '../../data/trips.js';

const VIEWS = [{ key: 'budget', label: 'תקציב ויעדים' }, { key: 'months', label: 'החודשים הקרובים' }, { key: 'trips', label: 'טיולים' }];
const viewOf = (hash) => (VIEWS.some((v) => v.key === routeView(hash)) ? routeView(hash) : 'budget');

export function PlansScreen({ data }) {
  const [view, setView] = useState(() => viewOf(location.hash));
  // A link to another view of this tab (#/plans/months) while it is open.
  useEffect(() => {
    const on = () => { if (/^#\/plans/.test(location.hash) && routeView(location.hash) && routeView(location.hash) !== 'checkin') setView(viewOf(location.hash)); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const sheet = usePlanSheet();
  // #/plans/checkin (the weekly check-in notification) opens the check-in.
  useEffect(() => {
    if (routeView(location.hash) !== 'checkin') return;
    history.replaceState(null, '', location.pathname + '#/plans');
    sheet.open({ kind: 'checkin' });
  }, []);
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
