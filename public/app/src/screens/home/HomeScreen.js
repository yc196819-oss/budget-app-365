import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { monthPlan, cashNow, upcoming, attention, topCategories } from '../../domain/home.js';
import { TxSheet } from '../money/TxSheet.js';
import { Hero } from './Hero.js';
import { HeroSheet } from './HeroSheet.js';
import { CashCard } from './CashCard.js';
import { Attention } from './Attention.js';
import { Upcoming } from './Upcoming.js';
import { WhereMoney } from './WhereMoney.js';
import { PlanCards } from '../plans/PlanCards.js';
import { PlanSheets, usePlanSheet } from '../plans/PlanSheets.js';

// The month at a glance: what is left to spend, where the month is heading,
// what needs attention (one action each) and what is coming up.
export function HomeScreen({ data, onAdd, onImport }) {
  // One sheet at a time: { kind: 'hero' } | { kind: 'tx', id } | null
  const [sheet, setSheet] = useState(null);
  // The holiday plan and the quarterly check-in have their own sheets.
  const planSheet = usePlanSheet();

  if (data.status === 'loading' || data.status === 'idle') return html`<div class="card empty" role="status">טוען…</div>`;
  if (data.status === 'error') {
    return html`<div class="card empty" role="alert"><b style="color:var(--text)">לא הצלחנו לטעון את הנתונים</b><span>${data.error}</span>
      <button type="button" class="btn btn-ghost" onClick=${data.reload}>לנסות שוב</button></div>`;
  }

  const today = new Date();
  const plan = monthPlan({ txs: data.txs, budgets: data.budgets, today });
  const cash = cashNow(data.accounts, data.cards, data.txs, today);
  const soon = upcoming({ txs: data.txs, cards: data.cards, today });
  const items = attention({ txs: data.txs, categories: data.categories, budgets: data.budgets, cards: data.cards, today, plan });
  const top = topCategories(data.txs, data.categories, data.budgets, today);

  if (!data.txs.length) {
    return html`<div class="stack">
      <div class="card empty">
        <b style="font-size:19px;color:var(--text)">עוד אין תנועות</b>
        <span style="max-width:320px;line-height:1.55">הדרך הכי מהירה: להעלות את הפירוט של 3 החודשים האחרונים מהאתר של חברת האשראי. לוקח דקה.</span>
        <button type="button" class="btn" style="width:100%;max-width:320px" onClick=${onImport}>העלאת פירוט כרטיס</button>
        <button type="button" class="btn btn-ghost" style="width:100%;max-width:320px" onClick=${onAdd}>הוספת הוצאה ידנית</button>
      </div>
    </div>`;
  }

  const act = (a) => {
    if (a.to === 'import') onImport();
    else if (a.to === 'tx') { planSheet.close(); setSheet({ kind: 'tx', id: a.id }); }
    else if (a.to === 'money-cats') location.hash = '#/money/cats';
    else location.hash = '#/' + a.to;
  };
  const sheetTx = sheet && sheet.kind === 'tx' ? data.txs.find((t) => t.id === sheet.id) : null;

  return html`<div class="stack home">
    <div class="home-main stack">
      <${Hero} plan=${plan} onOpen=${() => { planSheet.close(); setSheet({ kind: 'hero' }); }} />
      <${Attention} items=${items} onAct=${act} />
      <${PlanCards} data=${data} onSheet=${(s) => { setSheet(null); planSheet.open(s); }} />
      <${WhereMoney} top=${top} />
    </div>
    <div class="home-side stack">
      <${CashCard} cash=${cash} accounts=${data.accounts} />
      <${Upcoming} items=${soon} />
    </div>
    <${PlanSheets} data=${data} sheet=${planSheet.value} onClose=${planSheet.close} />
    ${sheet && sheet.kind === 'hero' && html`<${HeroSheet} plan=${plan} onClose=${() => setSheet(null)} />`}
    ${sheetTx && html`<${TxSheet} key=${sheetTx.id} tx=${sheetTx} txs=${data.txs} categories=${data.categories} members=${data.members} onClose=${() => setSheet(null)} />`}
  </div>`;
}
