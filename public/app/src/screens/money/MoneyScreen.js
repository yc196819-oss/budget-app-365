import { html } from '../../lib/html.js';
import { useMemo, useState } from 'preact/hooks';
import { Segmented } from '../../components/Segmented.js';
import { PeriodBar } from './PeriodBar.js';
import { ListView } from './ListView.js';
import { CategoriesView } from './CategoriesView.js';
import { ReportView } from './ReportView.js';
import { TxSheet } from './TxSheet.js';
import { CategorySheet } from './CategorySheet.js';
import { monthsBack } from '../../domain/money.js';

const VIEWS = [{ key: 'list', label: 'תנועות' }, { key: 'cats', label: 'קטגוריות' }, { key: 'report', label: 'דוח' }];

export function MoneyScreen({ data, onAdd, onImport }) {
  const months = useMemo(() => monthsBack(new Date(), 12), []);
  const [period, setPeriod] = useState('month');
  const [index, setIndex] = useState(months.length - 1);
  const [view, setView] = useState('list');
  // One sheet at a time: { kind: 'tx', id } | { kind: 'cat', id } | null
  const [sheet, setSheet] = useState(null);

  if (data.status === 'loading' || data.status === 'idle') return html`<div class="card empty" role="status">טוען את התנועות…</div>`;
  if (data.status === 'error') {
    return html`<div class="card empty" role="alert"><b style="color:var(--text)">לא הצלחנו לטעון את התנועות</b><span>${data.error}</span>
      <button type="button" class="btn btn-ghost" onClick=${data.reload}>לנסות שוב</button></div>`;
  }

  const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
  const periodMonths = period === 'year' ? months : [months[index]];
  const pickIndex = (i, fromStrip) => { setIndex(i); if (fromStrip) setPeriod('month'); };
  const openTx = (tx) => setSheet({ kind: 'tx', id: tx.id });
  const sheetTx = sheet && sheet.kind === 'tx' ? data.txs.find((t) => t.id === sheet.id) : null;
  const common = { txs: data.txs, categories: data.categories, budgets: data.budgets, periodMonths, period };

  return html`<div class="stack">
    <${PeriodBar} months=${months} period=${period} index=${index} onPeriod=${setPeriod} onIndex=${pickIndex} txs=${data.txs} />
    <${Segmented} variant="tabs" label="תצוגה" value=${view} onChange=${setView} options=${VIEWS} />
    ${view === 'list' && html`<${ListView} txs=${data.txs} months=${months} period=${period} index=${index} categoriesById=${categoriesById} onOpen=${openTx} onAdd=${onAdd} onImport=${onImport} />`}
    ${view === 'cats' && html`<${CategoriesView} ...${common} onOpenCategory=${(id) => setSheet({ kind: 'cat', id })} />`}
    ${view === 'report' && html`<${ReportView} ...${common} />`}
    ${sheetTx && html`<${TxSheet} key=${sheetTx.id} tx=${sheetTx} txs=${data.txs} categories=${data.categories} members=${data.members} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.kind === 'cat' && html`<${CategorySheet} categoryId=${sheet.id} ...${common} months=${months} onOpenTx=${openTx} onClose=${() => setSheet(null)} />`}
  </div>`;
}
