import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { dayLabel } from '../../domain/money.js';
import { looseTxs, looseGroups } from '../../domain/guide.js';
import { suggestCategories } from '../../data/importer.js';
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
  const [picks, setPicks] = useState({});
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const roots = (type) => data.categories.filter((c) => !c.parent_id && (type === 'income' ? c.kind === 'income' : c.kind !== 'income'));
  const kids = (id) => data.categories.filter((c) => c.parent_id === id);
  const valueOf = (p) => (p ? p.subcategory_id || p.category_id : '');
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
      setPicks((p) => ({ ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ? { ...v, saved: false, suggested: true } : v])), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v && v.saved)) }));
      showToast(Object.keys(s).length ? 'היועץ הציע ל-' + Object.keys(s).length + ' בתי עסק. בדקו ושמרו.' : 'היועץ לא היה בטוח באף אחד. אפשר לבחור ידנית.');
    } catch (_e) { showToast('היועץ לא זמין כרגע. אפשר לבחור ידנית.'); }
    setAsking(false);
  };
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
      ${aiOn && html`<button type="button" class="btn btn-ghost" disabled=${asking || saving} onClick=${suggest}>${asking ? 'היועץ חושב…' : 'שהיועץ יציע לכולם'}</button>`}
      <div class="list">${groups.map((g) => { const p = picks[g.key]; return html`<div class=${'sort-row' + (p && p.saved ? ' saved' : '')} key=${g.key} style="display:flex;flex-direction:column;gap:6px;padding:10px 0;border-bottom:1px solid var(--line)">
        <span style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.description}${g.generic && g.date ? html` <span class="muted" style="font-weight:400">· ${dayLabel(g.date, new Date())}</span>` : ''}</b>
          <span class="num muted" style="font-size:13px;white-space:nowrap">${g.ids.length > 1 ? g.ids.length + ' × · ' : ''}${g.type === 'income' ? '+' : ''}${money(g.total)}</span></span>
        <span style="display:flex;align-items:center;gap:8px">
          <select class="input" style="flex:1" aria-label=${'קטגוריה ל' + g.description + (g.generic && g.date ? ' ' + g.date : '')} value=${valueOf(p)} onChange=${(e) => choose(g, e.target.value)}>
            <option value="">בחרו קטגוריה</option>
            ${roots(g.type).map((r) => [html`<option value=${r.id}>${r.name}</option>`, ...kids(r.id).map((c) => html`<option value=${c.id}>— ${c.name}</option>`)])}
          </select>
          ${p && p.saved && html`<span class="sort-ok" aria-label="נשמר"><${Icon} name="check" size=${18} /></span>`}
          ${p && !p.saved && p.suggested && html`<span class="faint" style="font-size:12px;white-space:nowrap">הצעה</span>`}
        </span>
      </div>`; })}</div>
      <div style="display:flex;flex-direction:column;gap:6px"><span class="faint" style="font-size:13px">חסרה קטגוריה ברשימה? מוסיפים, והיא מופיעה בבחירה. מה שכבר בחרתם נשאר.</span><${NewCategory} categories=${data.categories} kind="expense" /></div>
      ${waitingSuggested.length > 0 && html`<button type="button" class="btn" disabled=${saving} onClick=${saveSuggested}>${saving ? 'שומר…' : 'לשמור את הצעות היועץ (' + waitingSuggested.length + ')'}</button>`}
      <button type="button" class=${'btn' + (waitingSuggested.length ? ' btn-ghost' : '')} onClick=${onClose}>סיימתי</button>
    </div>`}
  <//>`;
}
