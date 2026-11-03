import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { CatIcon } from '../../components/CatIcon.js';
import { NewCategory } from '../../components/NewCategory.js';
import { renameCategory } from '../../data/household.js';
import { checkCategoryName } from '../../domain/categories.js';
import { showToast } from '../../lib/toast.js';
import { Segmented } from '../../components/Segmented.js';
import { RulesList } from './RulesList.js';

// All the categories in one place: add a category or a sub-category, and
// rename one. (Categories with no spending yet show here too.)
export function ManageCategories({ categories, members = {}, onClose }) {
  const [kind, setKind] = useState('expense');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
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
      <button type="button" class="btn-text" style="font-size:13px" aria-label=${'לשנות שם: ' + c.name} onClick=${() => startEdit(c)}>שם</button>`);
  return html`<${Sheet} title="ניהול קטגוריות" onClose=${onClose}>
    <div class="stack manage-categories">
      <span class="muted" style="font-size:14px;line-height:1.55">מוסיפים קטגוריה משלכם, או תת-קטגוריה בתוך קטגוריה (למשל "חוגים" בתוך "ילדים"). אפשר גם לשנות שם.</span>
      <${Segmented} label="סוג" value=${kind} onChange=${(k) => { setKind(k); setEditing(null); }} options=${[{ key: 'expense', label: 'הוצאות' }, { key: 'income', label: 'הכנסות' }]} />
      <${NewCategory} categories=${categories} kind=${kind} label=${kind === 'income' ? '+ קטגוריית הכנסה חדשה' : '+ קטגוריה חדשה'} />
      ${error && html`<span class="error" role="alert" style="font-size:13px">${error}</span>`}
      <div class="list">${tops.map((c) => html`<div class="manage-row" key=${c.id} style="display:flex;flex-direction:column;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)">
        <span style="display:flex;align-items:center;gap:10px"><${CatIcon} category=${c} size=${34} />${nameOrEdit(c, false)}</span>
        <div style="display:flex;flex-direction:column;gap:4px;padding-inline-start:44px">
          ${kids(c.id).map((k) => html`<span key=${k.id} style="display:flex;align-items:center;gap:8px">${nameOrEdit(k, true)}</span>`)}
          <div><${NewCategory} categories=${categories} kind=${kind} parentId=${c.id} /></div>
        </div>
      </div>`)}</div>
      ${tops.length === 0 && html`<div class="card empty">עוד אין קטגוריות מהסוג הזה. מוסיפים למעלה.</div>`}
      <${RulesList} categories=${categories} kind=${kind} members=${members} />
    </div>
  <//>`;
}
