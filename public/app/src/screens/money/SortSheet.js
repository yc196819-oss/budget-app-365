import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { dayLabel } from '../../domain/money.js';
import { looseTxs, looseGroups } from '../../domain/guide.js';
import { suggestCategories } from '../../data/importer.js';
import { categorizeByWords, categorizeFromHistory } from '../../domain/statement.js';
import { setCategory, restoreCategories } from '../../data/household.js';
import { useAiSetting } from '../advisor/useAiSetting.js';
import { showToast } from '../../lib/toast.js';
import { NewCategory } from '../../components/NewCategory.js';
import { Icon } from '../../components/Icon.js';

// Everything still without a category, one line per merchant (a Bit payment
// or a transfer on its own line: each is something else). A choice is saved
// the moment it is made, so leaving the sheet (to add a category, or for
// anything else) loses nothing; it can still be changed here. The advisor's
// suggestions wait for one tap that saves them all.
export function SortSheet({ data, onClose }) {
  const aiOn = useAiSetting();
  // The rows as they were when the sheet opened: a row that was just sorted
  // stays, marked saved, so it can be changed again.
  const [groups] = useState(() => looseGroups(looseTxs(data.txs)));
  // key → { category_id, subcategory_id, saved: bool, undo: [...] }
  // Ready when the sheet opens: what the family chose before for the same
  // merchant, and investments by their words. Shown as suggestions; one tap
  // saves them all.
  const [picks, setPicks] = useState(() => readySuggestions(groups, data));
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const roots = (type) => data.categories.filter((c) => !c.parent_id && (type === 'income' ? c.kind === 'income' : c.kind !== 'income'));
  const kids = (id) => data.categories.filter((c) => c.parent_id === id);
  const valueOf = (p) => (p ? p.subcategory_id || p.category_id : '');
  const nameOf = (id) => (data.categories.find((c) => c.id === id) || {}).name || '';
  // The categories this family uses most, as one-tap buttons on each row.
  const [usage] = useState(() => {
    const n = {};
    for (const t of data.txs || []) if (t.category_id) n[t.category_id] = (n[t.category_id] || 0) + 1;
    return n;
  });
  const favs = (type) => roots(type).slice().sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0)).slice(0, 4).map((c) => c.id);
  const asPick = (id) => {
    const c = data.categories.find((x) => x.id === id);
    return !c ? null : c.parent_id ? { category_id: c.parent_id, subcategory_id: c.id } : { category_id: c.id, subcategory_id: null };
  };
  // Chosen by hand: saved now.
  const choose = async (g, id) => {
    const p = asPick(id);
    if (!p) return;
    setPicks((all) => ({ ...all, [g.key]: { ...p, saved: false } }));
    try {
      const undo = await setCategory(g.ids, p.category_id, p.subcategory_id);
      setPicks((all) => ({ ...all, [g.key]: { ...p, saved: true, undo: (all[g.key] && all[g.key].undo && all[g.key].undo.length ? all[g.key].undo : undo) } }));
    } catch (_e) {
      setPicks((all) => { const n = { ...all }; delete n[g.key]; return n; });
      showToast('לא נשמר. נסו שוב.');
    }
  };
  const suggest = async () => {
    setAsking(true);
    try {
      const s = await suggestCategories(groups.filter((g) => !(picks[g.key] && picks[g.key].saved)), data.categories);
      // A choice the person already made stays; the advisor's wait for "save".
      setPicks((p) => ({ ...p, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v).map(([k, v]) => [k, { ...v, saved: false, suggested: true }])), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v && v.saved)) }));
      showToast(Object.keys(s).length ? 'היועץ הציע ל-' + Object.keys(s).length + ' בתי עסק. בדקו ושמרו.' : 'היועץ לא היה בטוח באף אחד. אפשר לבחור ידנית.');
    } catch (_e) { showToast('היועץ לא זמין כרגע. אפשר לבחור ידנית.'); }
    setAsking(false);
  };
  const ready = groups.filter((g) => picks[g.key] && !picks[g.key].saved && picks[g.key].suggested === 'ready').length;
  const waitingSuggested = groups.filter((g) => picks[g.key] && !picks[g.key].saved && picks[g.key].suggested);
  const savedCount = groups.filter((g) => picks[g.key] && picks[g.key].saved).length;
  const saveSuggested = async () => {
    setSaving(true);
    const undo = [];
    try {
      for (const g of waitingSuggested) {
        const p = picks[g.key];
        undo.push(...(await setCategory(g.ids, p.category_id, p.subcategory_id)));
        setPicks((all) => ({ ...all, [g.key]: { ...p, saved: true } }));
      }
      const n = waitingSuggested.reduce((s, g) => s + g.ids.length, 0);
      showToast(n === 1 ? 'סווגה תנועה אחת' : 'סווגו ' + n + ' תנועות', { ms: 8000, undo: () => restoreCategories(undo).then(() => showToast('הסיווג בוטל')).catch(() => showToast('הביטול נכשל.')) });
    } catch (_e) { showToast('השמירה נכשלה. נסו שוב.'); }
    setSaving(false);
  };

  return html`<${Sheet} title="סיווג תנועות" onClose=${onClose}>
    ${groups.length === 0 ? html`<div class="card empty"><b style="color:var(--text)">הכול מסווג </b><span>כל התנועות שייכות לקטגוריה.</span></div>` : html`<div class="stack sort-sheet">
      <span class="muted" style="font-size:14px;line-height:1.55">${groups.length} שורות בלי קטגוריה. כל בחירה נשמרת מיד, ואפשר לצאת ולחזור בכל רגע.${groups.some((g) => g.generic) ? ' תשלומי ביט והעברות מופיעים כל אחד לבד, כי כל אחד הוא משהו אחר.' : ''}</span>
      ${savedCount > 0 && html`<span class="sort-saved" role="status"><${Icon} name="check" size=${16} />נשמרו ${savedCount} ${savedCount === 1 ? 'שורה' : 'שורות'}</span>`}
      ${ready > 0 && html`<span class="sort-ready" role="status">${ready === 1 ? 'לשורה אחת יש הצעה' : 'ל-' + ready + ' שורות יש הצעה'} לפי בית העסק (למשל השקעות). בדקו, ולחיצה אחת למטה שומרת הכול.</span>`}
      ${aiOn && html`<button type="button" class="btn btn-ghost" disabled=${asking || saving} onClick=${suggest}>${asking ? 'היועץ חושב…' : 'שהיועץ יציע לכולם'}</button>`}
      <div class="sort-cards">${groups.map((g) => {
        const p = picks[g.key];
        const cur = p ? p.subcategory_id || p.category_id : '';
        const root = p ? p.category_id : '';
        const chips = [...new Set([...(p && p.suggested && !p.saved ? [p.category_id] : []), ...favs(g.type)])].slice(0, 4);
        const label = cur ? nameOf(cur) : '';
        return html`<div class=${'sort-card' + (p && p.saved ? ' saved' : p && p.suggested ? ' suggested' : '')} key=${g.key}>
          <div class="sort-top"><b class="sort-name">${g.description}</b><span class=${'num sort-amt' + (g.type === 'income' ? ' income' : '')}>${g.type === 'income' ? '+' : ''}${money(g.total)}</span></div>
          <div class="sort-meta">${[g.generic && g.date ? dayLabel(g.date, new Date()) : null, g.ids.length > 1 ? g.ids.length + ' תנועות' : null].filter(Boolean).join(' · ')}
            ${p && p.saved ? html`<span class="sort-state ok"><${Icon} name="check" size=${14} />נשמר: ${label}</span>` : p && p.suggested ? html`<span class="sort-state sug">הצעה: ${label}</span>` : ''}</div>
          <div class="sort-chips" role="group" aria-label=${'קטגוריה מהירה ל' + g.description}>
            ${chips.map((id) => html`<button type="button" class="sort-chip" aria-pressed=${String(root === id)} onClick=${() => choose(g, id)}>${nameOf(id)}</button>`)}
            <select class="sort-other" aria-label=${'קטגוריה ל' + g.description + (g.generic && g.date ? ' ' + g.date : '')} value=${chips.includes(cur) ? '' : cur} onChange=${(e) => choose(g, e.target.value)}>
              <option value="">${chips.length ? 'קטגוריה אחרת…' : 'בחרו קטגוריה'}</option>
              ${roots(g.type).map((r) => [html`<option value=${r.id}>${r.name}</option>`, ...kids(r.id).map((c) => html`<option value=${c.id}>— ${c.name}</option>`)])}
            </select>
          </div>
        </div>`; })}</div>
      <div style="display:flex;flex-direction:column;gap:6px"><span class="faint" style="font-size:13px">חסרה קטגוריה ברשימה? מוסיפים, והיא מופיעה בבחירה. מה שכבר בחרתם נשאר.</span><${NewCategory} categories=${data.categories} kind="expense" /></div>
      ${waitingSuggested.length > 0 && html`<button type="button" class="btn" disabled=${saving} onClick=${saveSuggested}>${saving ? 'שומר…' : 'לשמור את כל ההצעות (' + waitingSuggested.length + ')'}</button>`}
      <button type="button" class=${'btn' + (waitingSuggested.length ? ' btn-ghost' : '')} onClick=${onClose}>סיימתי</button>
    </div>`}
  <//>`;
}

// The suggestions that need no advisor: the family's own earlier choice for
// the same merchant, then investments by their words.
export function readySuggestions(groups, data) {
  const history = (data.txs || []).filter((t) => t.category_id);
  const items = groups.map((g) => ({ key: g.key, description: g.description, type: g.type, category_id: null, generic: g.generic }));
  // A standing order or transfer is each something else: no earlier choice
  // carries over to it, but its own words (a fund, securities) still count.
  const fromHistory = categorizeFromHistory(items.filter((t) => !t.generic), history);
  const guessed = categorizeByWords([...fromHistory, ...items.filter((t) => t.generic)], data.categories || []);
  const out = {};
  for (const t of guessed) if (t.category_id) out[t.key] = { category_id: t.category_id, subcategory_id: t.subcategory_id || null, saved: false, suggested: 'ready' };
  return out;
}
