import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Segmented } from '../../components/Segmented.js';
import { routeView } from '../../domain/routes.js';
import { ComingMonths } from './ComingMonths.js';
import { BudgetGoals } from './BudgetGoals.js';
import { PlanSheets, usePlanSheet } from './PlanSheets.js';

const VIEWS = [{ key: 'months', label: 'החודשים הקרובים' }, { key: 'budget', label: 'תקציב ויעדים' }];

export function PlansScreen({ data }) {
  const [view, setView] = useState(() => (VIEWS.some((v) => v.key === routeView(location.hash)) ? routeView(location.hash) : 'months'));
  const sheet = usePlanSheet();

  if (data.status === 'loading' || data.status === 'idle') return html`<div class="card empty" role="status">טוען…</div>`;
  if (data.status === 'error') {
    return html`<div class="card empty" role="alert"><b style="color:var(--text)">לא הצלחנו לטעון את הנתונים</b><span>${data.error}</span>
      <button type="button" class="btn btn-ghost" onClick=${data.reload}>לנסות שוב</button></div>`;
  }
  return html`<div class="stack">
    <${Segmented} variant="tabs" label="תצוגה" value=${view} onChange=${setView} options=${VIEWS} />
    ${view === 'months' && html`<${ComingMonths} data=${data} onSheet=${sheet.open} onBudget=${() => setView('budget')} />`}
    ${view === 'budget' && html`<${BudgetGoals} data=${data} />`}
    <${PlanSheets} data=${data} sheet=${sheet.value} onClose=${sheet.close} />
  </div>`;
}
