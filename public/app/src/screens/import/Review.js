import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { CatIcon } from '../../components/CatIcon.js';
import { Segmented } from '../../components/Segmented.js';
import { money, shortDate } from '../../domain/format.js';
import { summary, setItemCategory } from '../../domain/statement.js';

// What was found in the file, before saving. Lines that probably exist
// already start unchecked. Choosing a category fills the other lines of the
// same merchant too.
export function Review({ items, categories, onChange, onSave, saving, onAnother }) {
  const [filter, setFilter] = useState(() => (items.some((t) => !t.category_id) ? 'waiting' : 'all'));
  const [open, setOpen] = useState(null);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const s = summary(items);
  const visible = items.filter((t) => !t.saved && (filter === 'all' || (filter === 'waiting' ? t.include && !t.category_id : t.dupe)));

  const toggle = (key) => onChange(items.map((t) => (t.key === key ? { ...t, include: !t.include } : t)));
  const choose = (key, category_id, subcategory_id) => onChange(setItemCategory(items, key, category_id, subcategory_id));

  return html`
    <div class="import-summary">
      <b>${s.found} תנועות נמצאו</b>
      <span>${[
        s.auto + ' סווגו לבד',
        s.waiting ? s.waiting + ' מחכות לכם' : null,
        s.likely ? s.likely + ' כבר במערכת ולא יישמרו' : null,
        s.maybe ? s.maybe + ' אולי כפולות' : null
      ].filter(Boolean).join(' · ')}</span>
      ${s.from && html`<span>${'מ-' + shortDate(s.from) + ' עד ' + shortDate(s.to) + ' · הוצאות ' + money(s.expense) + (s.income ? ' · זיכויים ' + money(s.income) : '')}</span>`}
    </div>
    <${Segmented} variant="tabs" label="סינון" value=${filter} onChange=${(f) => { setFilter(f); setOpen(null); }} options=${[
      { key: 'waiting', label: 'מחכות (' + s.waiting + ')' },
      { key: 'dupes', label: 'כפולות (' + (s.likely + s.maybe) + ')' },
      { key: 'all', label: 'הכול (' + s.found + ')' }
    ]} />
    ${visible.length === 0 && html`<div class="empty">${filter === 'waiting' ? 'כל התנועות מסווגות.' : filter === 'dupes' ? 'לא נמצאו כפילויות.' : 'אין תנועות.'}</div>`}
    ${visible.length > 0 && html`<div class="list import-list">
      ${visible.map((t) => html`<${Line} key=${t.key} t=${t} byId=${byId} categories=${categories} open=${open === t.key}
        onToggle=${() => toggle(t.key)} onOpen=${() => setOpen(open === t.key ? null : t.key)} onChoose=${(c, sub) => choose(t.key, c, sub)} />`)}
    </div>`}
    <div class="import-actions">
      <button type="button" class="btn" disabled=${!s.chosen || saving} onClick=${onSave}>${saving ? 'שומר…' : 'לשמור ' + s.chosen + ' תנועות'}</button>
      <button type="button" class="btn btn-ghost" disabled=${saving} onClick=${onAnother}>קובץ אחר</button>
    </div>`;
}

function Line({ t, byId, categories, open, onToggle, onOpen, onChoose }) {
  const cat = byId.get(t.category_id);
  const sub = byId.get(t.subcategory_id);
  const kind = t.type === 'income' ? 'income' : 'expense';
  const tops = categories.filter((c) => !c.parent_id && (c.kind || 'expense') === kind);
  const subs = t.category_id ? categories.filter((c) => c.parent_id === t.category_id) : [];
  let note;
  if (t.dupe === 'likely') note = html`<span class="warn">כבר קיימת: ${shortDate(t.dupeOf.date)} ${t.dupeOf.description}</span>`;
  else if (t.dupe === 'maybe') note = html`<span class="warn">אולי כפולה: ${shortDate(t.dupeOf.date)} ${t.dupeOf.description}</span>`;
  else if (!cat) note = html`<span class="warn">מחכה לקטגוריה</span>`;
  else note = html`<span>${(sub ? sub.name : cat.name) + (t.auto === 'history' ? ' · כמו בפעם הקודמת' : t.auto === 'ai' ? ' · הצעה' : '')}</span>`;
  return html`<div class=${'import-line' + (t.include ? '' : ' off')}>
    <div class="row">
      <input type="checkbox" class="import-check" checked=${t.include} onChange=${onToggle} aria-label=${'לשמור את ' + t.description} />
      <button type="button" class="import-open" aria-expanded=${String(open)} onClick=${onOpen}>
        <${CatIcon} category=${cat} size=${34} />
        <span class="row-main"><b>${t.description}</b><span>${shortDate(t.date)} · ${note}</span></span>
        <span class=${'amt num' + (t.type === 'income' ? ' income' : '')}>${(t.type === 'income' ? '+' : '') + money(t.amount)}</span>
      </button>
    </div>
    ${open && html`<div class="import-pick">
      <div class="chips">${tops.map((c) => html`<button type="button" class="chip" aria-pressed=${String(t.category_id === c.id)} onClick=${() => onChoose(c.id, null)}>${c.icon || ''} ${c.name}</button>`)}</div>
      ${subs.length > 0 && html`<div class="chips">${subs.map((c) => html`<button type="button" class="chip" aria-pressed=${String(t.subcategory_id === c.id)} onClick=${() => onChoose(t.category_id, c.id)}>${c.name}</button>`)}</div>`}
    </div>`}
  </div>`;
}
