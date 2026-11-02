import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
import { addCategory } from '../data/household.js';
import { checkCategoryName, CATEGORY_ICONS } from '../domain/categories.js';
import { showToast } from '../lib/toast.js';

// "+ קטגוריה חדשה": a chip that opens a short form (a name, and an icon for a
// top-level one). The new category is saved and handed back, so the screen
// can use it right away (for example, put the transaction in it).
export function NewCategory({ categories, kind = 'expense', parentId = null, label, onCreated, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const text = label || (parentId ? '+ תת-קטגוריה' : '+ קטגוריה חדשה');
  if (!open) return html`<button type="button" class="chip chip-add" onClick=${() => setOpen(true)}>${text}</button>`;
  const save = async (e) => {
    e.preventDefault();
    const check = checkCategoryName(name, { categories, kind, parentId });
    if (check.error) {
      // Already there: use it instead of making a twin.
      if (check.existing) { setOpen(false); setName(''); onCreated && onCreated(check.existing); showToast('נבחרה הקטגוריה הקיימת "' + check.existing.name + '"'); return; }
      setError(check.error); return;
    }
    setBusy(true);
    try {
      const cat = await addCategory({ name: check.name, kind, parentId, icon });
      setOpen(false); setName(''); setIcon(''); setError('');
      showToast('נוספה הקטגוריה "' + cat.name + '"');
      onCreated && onCreated(cat);
    } catch (_e) { setError('לא נשמרה. נסו שוב.'); }
    setBusy(false);
  };
  return html`<form class="new-category card" onSubmit=${save}>
    <b style="font-size:14px">${parentId ? 'תת-קטגוריה חדשה' : 'קטגוריה חדשה'}</b>
    <input class="input" maxlength="40" aria-label="שם הקטגוריה" placeholder=${parentId ? 'למשל: חוגים' : 'למשל: חיות מחמד'} value=${name} onInput=${(e) => { setName(e.target.value); setError(''); }} autofocus />
    ${!parentId && html`<div class="chips icon-pick" role="radiogroup" aria-label="סמל">${CATEGORY_ICONS.map((i) => html`<button type="button" role="radio" class="chip" aria-checked=${String(icon === i)} aria-pressed=${String(icon === i)} onClick=${() => setIcon(icon === i ? '' : i)}>${i}</button>`)}</div>`}
    ${error && html`<span class="error" role="alert" style="font-size:13px">${error}</span>`}
    <div style="display:flex;gap:8px">
      <button type="submit" class="btn" style="flex:1" disabled=${busy || name.trim().length < 2}>${busy ? 'שומר…' : 'להוסיף'}</button>
      <button type="button" class="btn btn-ghost" style="width:auto" onClick=${() => { setOpen(false); setError(''); }}>ביטול</button>
    </div>
  </form>`;
}
