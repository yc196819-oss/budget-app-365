import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { CatIcon } from '../../components/CatIcon.js';
import { dayLabel, sameMerchantIds } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { setCategory, restoreCategories, deleteWithUndo } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// Details of one transaction: change its category (optionally for all
// transactions of the same merchant) or delete it. Both can be undone.
export function TxSheet({ tx, txs, categories, members, onClose }) {
  const [applyAll, setApplyAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const kind = tx.type === 'income' ? 'income' : 'expense';
  const tops = categories.filter((c) => !c.parent_id && (c.kind || 'expense') === kind);
  const subs = categories.filter((c) => c.parent_id && c.parent_id === tx.category_id);
  const others = sameMerchantIds(tx, txs);
  const income = tx.type === 'income';

  const choose = async (category_id, subcategory_id = null) => {
    if (busy) return;
    if (category_id === (tx.category_id || null) && subcategory_id === (tx.subcategory_id || null)) return;
    setBusy(true);
    const ids = applyAll && others.length ? [tx.id, ...others] : [tx.id];
    try {
      const before = await setCategory(ids, category_id, subcategory_id);
      const name = (byId.get(subcategory_id) || byId.get(category_id) || { name: 'בלי קטגוריה' }).name;
      showToast(ids.length > 1 ? 'עודכנו ' + ids.length + ' תנועות של ' + tx.description + ' ← ' + name : 'עודכן ← ' + name, {
        undo: () => restoreCategories(before).catch(() => showToast('הביטול נכשל. נסו שוב.'))
      });
    } catch (_err) {
      showToast('השינוי נכשל. נסו שוב.');
    }
    setBusy(false);
  };

  const remove = () => {
    const undo = deleteWithUndo(tx.id);
    onClose();
    showToast('התנועה נמחקה', { undo });
  };

  return html`<${Sheet} title="פרטי תנועה" onClose=${onClose}>
    <div style="display:flex;align-items:center;gap:14px">
      <${CatIcon} category=${byId.get(tx.category_id)} size=${52} />
      <span style="flex:1;min-width:0;display:flex;flex-direction:column"><b style="font-size:19px">${tx.description}</b><span class="muted" style="font-size:13px">${dayLabel(tx.tx_date, new Date())}</span></span>
      <b class=${'num' + (income ? ' income' : '')} style=${'font-size:22px;' + (income ? 'color:var(--income)' : '')}>${(income ? '+' : '−') + money(tx.amount)}</b>
    </div>
    <div class="facts">
      ${tx.payment_method && html`<div><span>אמצעי תשלום</span><b>${tx.payment_method}</b></div>`}
      <div><span>נוסף על ידי</span><b>${members[tx.created_by] || '—'}</b></div>
      <div><span>סוג</span><b>${tx.nature === 'fixed' ? 'קבועה' : 'משתנה'}${tx.spread === 'year' ? ' · מחולקת על 12 חודשים' : ''}</b></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <b style="font-size:13px;color:var(--muted)">קטגוריה</b>
      <div class="chips">
        ${tops.map((c) => html`<button type="button" class="chip" aria-pressed=${String(tx.category_id === c.id)} disabled=${busy} onClick=${() => choose(c.id, null)}>${c.icon || ''} ${c.name}</button>`)}
      </div>
      ${subs.length > 0 && html`<div class="chips">
        ${subs.map((c) => html`<button type="button" class="chip" aria-pressed=${String(tx.subcategory_id === c.id)} disabled=${busy} onClick=${() => choose(tx.category_id, c.id)}>${c.name}</button>`)}
      </div>`}
      ${others.length > 0 && html`<label class="check"><input type="checkbox" checked=${applyAll} onChange=${(e) => setApplyAll(e.target.checked)} />
        <span>לשנות גם ב-${others.length} התנועות האחרות של ${tx.description}</span></label>`}
    </div>
    <button type="button" class="btn btn-ghost" style="color:var(--danger)" onClick=${remove}>מחיקת התנועה</button>
  <//>`;
}
