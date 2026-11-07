import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { NewCategory } from '../../components/NewCategory.js';
import { Sheet } from '../../components/Sheet.js';
import { CatIcon } from '../../components/CatIcon.js';
import { dayLabel, sameMerchantIds, filterTxs, monthsBack, inMonth } from '../../domain/money.js';
import { chainQuery } from '../../domain/spend.js';
import { money } from '../../domain/format.js';
import { setCategory, restoreCategories, deleteWithUndo, snapshot } from '../../data/household.js';
import { listRules, saveRule } from '../../data/rules.js';
import { shouldAskRule } from '../../domain/rules.js';
import { Icon } from '../../components/Icon.js';
import { showToast } from '../../lib/toast.js';

// Details of one transaction: change its category (optionally for all
// transactions of the same merchant) or delete it. Both can be undone.
export function TxSheet({ tx, txs, categories, members, onClose, onMerchant }) {
  const [applyAll, setApplyAll] = useState(true);
  const [busy, setBusy] = useState(false);
  // After a change: offer to keep it as a rule for this merchant.
  const [ask, setAsk] = useState(null);
  const [rules, setRules] = useState([]);
  const hid = snapshot().hid;
  useEffect(() => { if (hid) listRules(hid).then(setRules).catch(() => setRules([])); }, [hid]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const kind = tx.type === 'income' ? 'income' : 'expense';
  const tops = categories.filter((c) => !c.parent_id && (c.kind || 'expense') === kind);
  const subs = categories.filter((c) => c.parent_id && c.parent_id === tx.category_id);
  const others = sameMerchantIds(tx, txs);
  const income = tx.type === 'income';

  const choose = async (category_id, subcategory_id = null, created = null) => {
    if (busy) return;
    if (category_id === (tx.category_id || null) && subcategory_id === (tx.subcategory_id || null)) return;
    setBusy(true);
    const ids = applyAll && others.length ? [tx.id, ...others] : [tx.id];
    try {
      const before = await setCategory(ids, category_id, subcategory_id);
      const name = (created || byId.get(subcategory_id) || byId.get(category_id) || { name: 'בלי קטגוריה' }).name;
      setAsk(shouldAskRule(rules, tx, category_id, subcategory_id) ? { category_id, subcategory_id, name, state: 'ask' } : null);
      showToast(ids.length > 1 ? 'עודכנו ' + ids.length + ' תנועות של ' + tx.description + ' ← ' + name : 'עודכן ← ' + name, {
        undo: () => restoreCategories(before).catch(() => showToast('הביטול נכשל. נסו שוב.'))
      });
    } catch (_err) {
      showToast('השינוי נכשל. נסו שוב.');
    }
    setBusy(false);
  };

  const keepRule = async () => {
    try {
      const r = await saveRule({ hid, tx, category_id: ask.category_id, subcategory_id: ask.subcategory_id });
      setRules((l) => [r, ...l.filter((x) => x.id !== r.id)]);
      setAsk({ ...ask, state: 'saved' });
    } catch (_e) { showToast('הכלל לא נשמר. נסו שוב.'); }
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
    ${onMerchant && !income && (() => {
      // Every purchase at this place in the last 12 months, in one tap.
      const q = chainQuery(tx.description);
      if (!q) return null;
      const months = monthsBack(new Date(), 12);
      const all = filterTxs(txs.filter((t) => t.type !== 'income' && months.some((mo) => inMonth(t, mo))), { query: q });
      if (all.length < 2) return null;
      const total = all.reduce((s, t) => s + Number(t.amount), 0);
      return html`<button type="button" class="btn btn-ghost tx-merchant" onClick=${() => onMerchant(q)}>כל הקניות ב${q}: ${money(total)} ב-12 חודשים ›</button>`;
    })()}
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
      <${NewCategory} categories=${categories} kind=${kind} onCreated=${(c) => choose(c.id, null, c)} />
      ${tx.category_id && html`<div class="chips">
        ${subs.map((c) => html`<button type="button" class="chip" aria-pressed=${String(tx.subcategory_id === c.id)} disabled=${busy} onClick=${() => choose(tx.category_id, c.id)}>${c.name}</button>`)}
        <${NewCategory} categories=${categories} kind=${kind} parentId=${tx.category_id} onCreated=${(c) => choose(tx.category_id, c.id, c)} />
      </div>`}
      ${ask && ask.state === 'ask' && html`<div class="card stack rule-ask" role="status">
        <b class="rule-ask-q"><${Icon} name="bulb" size=${18} />לסווג תמיד את ${tx.description} כ"${ask.name}"?</b>
        <span class="muted" style="font-size:14px;line-height:1.55">גם בפירוטים הבאים, ואצל שניכם. אפשר לשנות בכל רגע בניהול הקטגוריות.</span>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn" style="flex:1" onClick=${keepRule}>כן, תמיד</button>
          <button type="button" class="btn btn-ghost" style="flex:1" onClick=${() => setAsk(null)}>רק הפעם</button>
        </div>
      </div>`}
      ${ask && ask.state === 'saved' && html`<div class="card rule-saved" role="status"><${Icon} name="check" size=${18} />נשמר: ${tx.description} ← ${ask.name}. מעכשיו זה יסווג לבד.</div>`}
      ${others.length > 0 && html`<label class="check"><input type="checkbox" checked=${applyAll} onChange=${(e) => setApplyAll(e.target.checked)} />
        <span>לשנות גם ב-${others.length} התנועות האחרות של ${tx.description}</span></label>`}
    </div>
    <button type="button" class="btn btn-ghost" style="color:var(--danger)" onClick=${remove}>מחיקת התנועה</button>
  <//>`;
}
