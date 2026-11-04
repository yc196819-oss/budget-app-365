import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { CatIcon } from '../../components/CatIcon.js';
import { NewCategory } from '../../components/NewCategory.js';
import { renameCategory, deleteCategory, categoryTxCount, snapshot } from '../../data/household.js';
import { listRules } from '../../data/rules.js';
import { checkCategoryName } from '../../domain/categories.js';
import { showToast } from '../../lib/toast.js';
import { Segmented } from '../../components/Segmented.js';
import { RulesList } from './RulesList.js';

// All the categories in one place: add a category or a sub-category,
// rename or delete one. (Categories with no spending yet show here too.)
export function ManageCategories({ categories, members = {}, onClose }) {
  const [kind, setKind] = useState('expense');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  const tops = categories.filter((c) => !c.parent_id && (c.kind || 'expense') === kind).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  const kids = (id) => categories.filter((c) => c.parent_id === id);
  const startEdit = (c) => { setEditing(c.id); setDraft(c.name); setError(''); };
  const saveEdit = async (e, c) => {
    e.preventDefault();
    const check = checkCategoryName(draft, { categories, kind: c.kind || 'expense', parentId: c.parent_id || null, exceptId: c.id });
    if (check.error) { setError(check.error); return; }
    try { await renameCategory(c.id, { name: check.name }); setEditing(null); showToast('השם עודכן'); } catch (_e) { setError('לא נשמר. נסו שוב.'); }
  };
  const nameOrEdit = (c, small) => (editing === c.id
    ? html`<form class="rename-form" style="display:flex;gap:6px;flex:1" onSubmit=${(e) => saveEdit(e, c)}>
        <input class="input" style="flex:1" maxlength="40" aria-label=${'שם חדש ל' + c.name} value=${draft} onInput=${(e) => { setDraft(e.target.value); setError(''); }} autofocus />
        <button type="submit" class="btn" style="width:auto;padding:6px 12px">לשמור</button>
        <button type="button" class="btn-text" onClick=${() => setEditing(null)}>ביטול</button>
      </form>`
    : html`<span style=${'flex:1;' + (small ? 'font-size:14px' : 'font-size:15px;font-weight:700')}>${c.name}</span>
      <button type="button" class="btn-text" style="font-size:13px" aria-label=${'לשנות שם: ' + c.name} onClick=${() => startEdit(c)}>שם</button>
      <button type="button" class="btn-text" style="font-size:13px;color:var(--danger)" aria-label=${'למחוק: ' + c.name} onClick=${() => setRemoving(removing === c.id ? null : c.id)}>למחוק</button>`);
  const removeBox = (c) => removing === c.id && html`<${DeleteCategory} key=${'del' + c.id} category=${c} categories=${categories} onDone=${() => setRemoving(null)} />`;
  return html`<${Sheet} title="ניהול קטגוריות" onClose=${onClose}>
    <div class="stack manage-categories">
      <span class="muted" style="font-size:14px;line-height:1.55">מוסיפים קטגוריה משלכם, או תת-קטגוריה בתוך קטגוריה (למשל "חוגים" בתוך "ילדים"). אפשר גם לשנות שם או למחוק.</span>
      <${Segmented} label="סוג" value=${kind} onChange=${(k) => { setKind(k); setEditing(null); }} options=${[{ key: 'expense', label: 'הוצאות' }, { key: 'income', label: 'הכנסות' }]} />
      <${NewCategory} categories=${categories} kind=${kind} label=${kind === 'income' ? '+ קטגוריית הכנסה חדשה' : '+ קטגוריה חדשה'} />
      ${error && html`<span class="error" role="alert" style="font-size:13px">${error}</span>`}
      <div class="list">${tops.map((c) => html`<div class="manage-row" key=${c.id} style="display:flex;flex-direction:column;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)">
        <span style="display:flex;align-items:center;gap:10px"><${CatIcon} category=${c} size=${34} />${nameOrEdit(c, false)}</span>
        ${removeBox(c)}
        <div style="display:flex;flex-direction:column;gap:4px;padding-inline-start:44px">
          ${kids(c.id).map((k) => html`<span key=${k.id} style="display:flex;align-items:center;gap:8px">${nameOrEdit(k, true)}</span>${removeBox(k)}`)}
          <div><${NewCategory} categories=${categories} kind=${kind} parentId=${c.id} /></div>
        </div>
      </div>`)}</div>
      ${tops.length === 0 && html`<div class="card empty">עוד אין קטגוריות מהסוג הזה. מוסיפים למעלה.</div>`}
      <${RulesList} categories=${categories} kind=${kind} members=${members} />
    </div>
  <//>`;
}

// Deleting a category, asked in place. A sub-category's transactions stay
// in its parent. A category with transactions, a budget or rules first
// says where they go; an empty one only asks to be sure.
function DeleteCategory({ category: c, categories, onDone }) {
  const [info, setInfo] = useState(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const parent = c.parent_id ? categories.find((x) => x.id === c.parent_id) : null;
  const subs = categories.filter((x) => x.parent_id === c.id);
  const targets = parent ? [] : categories.filter((x) => !x.parent_id && x.id !== c.id && (x.kind || 'expense') === (c.kind || 'expense'));
  useEffect(() => {
    let live = true;
    const hid = snapshot().hid;
    Promise.all([categoryTxCount(c.id), parent ? [] : listRules(hid).catch(() => [])])
      .then(([count, rules]) => {
        if (!live) return;
        const budget = (snapshot().budgets || []).find((b) => b.category_id === c.id);
        setInfo({ count, rules: rules.filter((r) => r.category_id === c.id).length, budget: budget ? Number(budget.monthly_amount) || 0 : 0 });
      })
      .catch(() => live && setFailed('לא הצלחנו לבדוק מה יש בקטגוריה. נסו שוב.'));
    return () => { live = false; };
  }, [c.id]);
  const needsTarget = !parent && info && (info.count > 0 || info.rules > 0 || info.budget > 0);
  const go = async () => {
    if (busy || (needsTarget && !target)) return;
    setBusy(true); setFailed('');
    try {
      await deleteCategory(c.id, needsTarget ? target : null);
      const to = categories.find((x) => x.id === target);
      showToast(c.name + ' נמחקה' + (needsTarget && to ? '. הכול עבר ל' + to.name : ''));
      onDone();
    } catch (_e) { setFailed('המחיקה נכשלה. נסו שוב.'); setBusy(false); }
  };
  const what = info && [info.count ? (info.count === 1 ? 'תנועה אחת' : info.count + ' תנועות') : '', info.budget ? 'תקציב חודשי' : '', info.rules ? (info.rules === 1 ? 'כלל סיווג אחד' : info.rules + ' כללי סיווג') : ''].filter(Boolean).join(', ');
  return html`<div class="card stack cat-delete" role="group" aria-label=${'מחיקת ' + c.name} style="gap:8px;border:1.5px solid var(--danger)">
    ${!info && !failed && html`<span class="muted" style="font-size:14px">בודקים מה יש בקטגוריה…</span>`}
    ${info && parent && html`<span style="font-size:14px;line-height:1.55">למחוק את <b>${c.name}</b>? ${info.count ? (info.count === 1 ? 'התנועה שלה תישאר' : 'ה-' + info.count + ' תנועות שלה יישארו') + ' ב' + parent.name + '.' : 'אין בה תנועות.'}</span>`}
    ${info && !parent && !needsTarget && html`<span style="font-size:14px;line-height:1.55">למחוק את <b>${c.name}</b>${subs.length ? ' ואת ' + (subs.length === 1 ? 'תת-הקטגוריה שלה' : subs.length + ' תתי-הקטגוריות שלה') : ''}? אין בה תנועות.</span>`}
    ${needsTarget && targets.length === 0 && html`<span style="font-size:14px;line-height:1.55">ב<b>${c.name}</b> יש ${what}. כדי למחוק אותה צריך קטגוריה נוספת מאותו סוג להעביר אליה. מוסיפים אחת למעלה.</span>`}
    ${needsTarget && targets.length > 0 && html`
      <span style="font-size:14px;line-height:1.55">ב<b>${c.name}</b> יש ${what}. לאן להעביר?${subs.length ? ' (תתי-הקטגוריות שלה יימחקו, והתנועות שלהן יעברו גם הן.)' : ''}</span>
      <select class="input" aria-label="לאן להעביר" value=${target} onChange=${(e) => setTarget(e.target.value)}>
        <option value="">בחרו קטגוריה</option>
        ${targets.map((t) => html`<option value=${t.id}>${t.name}</option>`)}
      </select>
      ${info.budget > 0 && html`<span class="muted" style="font-size:14px">התקציב החודשי יתווסף לתקציב של הקטגוריה שתבחרו.</span>`}`}
    ${info && !(needsTarget && targets.length === 0) && html`<span class="muted" style="font-size:14px">התחרטתם? הקטגוריה נשמרת 30 יום בפרופיל ← "המידע שלנו", ואפשר להחזיר אותה.</span>`}
    ${failed && html`<span class="error" role="alert" style="font-size:14px">${failed}</span>`}
    <div style="display:flex;gap:8px">
      ${info && !(needsTarget && targets.length === 0) && html`<button type="button" class="btn" style="flex:1;background:var(--danger)" disabled=${busy || (needsTarget && !target)} onClick=${go}>${busy ? 'מוחקים…' : needsTarget ? 'להעביר ולמחוק' : 'כן, למחוק'}</button>`}
      <button type="button" class="btn btn-ghost" style="flex:1" onClick=${onDone}>ביטול</button>
    </div>
  </div>`;
}
