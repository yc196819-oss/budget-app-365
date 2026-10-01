import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { CatIcon } from '../../components/CatIcon.js';

export function TxRow({ tx, categoriesById, showDate, onOpen }) {
  const cat = categoriesById.get(tx.subcategory_id) || categoriesById.get(tx.category_id);
  const top = categoriesById.get(tx.category_id);
  const income = tx.type === 'income';
  const d = String(tx.tx_date).split('-');
  const sub = [showDate ? Number(d[2]) + '.' + Number(d[1]) : null, cat ? cat.name : 'בלי קטגוריה', tx.spread === 'year' ? 'מחולק על 12 חודשים' : null].filter(Boolean).join(' · ');
  return html`<button type="button" class="row" onClick=${() => onOpen(tx)}>
    <${CatIcon} category=${top || cat} />
    <span class="row-main"><b>${tx.description}</b><span>${sub}</span></span>
    <span class=${'amt num' + (income ? ' income' : '')}>${(income ? '+' : '−') + money(tx.amount)}</span>
  </button>`;
}
