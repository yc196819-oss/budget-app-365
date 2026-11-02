import { html } from '../../lib/html.js';
import { useMemo, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { looseTxs, looseGroups } from '../../domain/guide.js';
import { suggestCategories } from '../../data/importer.js';
import { setCategory, restoreCategories } from '../../data/household.js';
import { useAiSetting } from '../advisor/useAiSetting.js';
import { showToast } from '../../lib/toast.js';

// Everything still without a category, one line per merchant: the advisor
// suggests, the person checks and saves all at once (with undo).
export function SortSheet({ data, onClose }) {
  const aiOn = useAiSetting();
  const groups = useMemo(() => looseGroups(looseTxs(data.txs)), [data.txs]);
  const [picks, setPicks] = useState({});
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const roots = (type) => data.categories.filter((c) => !c.parent_id && (type === 'income' ? c.kind === 'income' : c.kind !== 'income'));
  const kids = (id) => data.categories.filter((c) => c.parent_id === id);
  const valueOf = (p) => (p ? p.subcategory_id || p.category_id : '');
  const choose = (g, id) => {
    const c = data.categories.find((x) => x.id === id);
    setPicks((p) => ({ ...p, [g.key]: !c ? null : c.parent_id ? { category_id: c.parent_id, subcategory_id: c.id } : { category_id: c.id, subcategory_id: null } }));
  };
  const suggest = async () => {
    setAsking(true);
    try {
      const s = await suggestCategories(groups, data.categories);
      // A choice the person already made stays.
      setPicks((p) => ({ ...s, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) }));
      showToast(Object.keys(s).length ? 'היועץ הציע ל-' + Object.keys(s).length + ' בתי עסק. בדקו ושמרו.' : 'היועץ לא היה בטוח באף אחד. אפשר לבחור ידנית.');
    } catch (_e) { showToast('היועץ לא זמין כרגע. אפשר לבחור ידנית.'); }
    setAsking(false);
  };
  const chosen = groups.filter((g) => picks[g.key]);
  const save = async () => {
    setSaving(true);
    const undo = [];
    try {
      for (const g of chosen) undo.push(...(await setCategory(g.ids, picks[g.key].category_id, picks[g.key].subcategory_id)));
      onClose();
      const n = chosen.reduce((s, g) => s + g.ids.length, 0);
      showToast('סווגו ' + n + ' תנועות', { ms: 8000, undo: () => restoreCategories(undo).then(() => showToast('הסיווג בוטל')).catch(() => showToast('הביטול נכשל.')) });
    } catch (_e) { setSaving(false); showToast('השמירה נכשלה. נסו שוב.'); }
  };

  return html`<${Sheet} title="סיווג תנועות" onClose=${onClose}>
    ${groups.length === 0 ? html`<div class="card empty"><b style="color:var(--text)">הכול מסווג 🎉</b><span>כל התנועות שייכות לקטגוריה.</span></div>` : html`<div class="stack sort-sheet">
      <span class="muted" style="font-size:14px;line-height:1.55">${groups.length} בתי עסק בלי קטגוריה. בוחרים פעם אחת, וכל התנועות שלהם מסתדרות.</span>
      ${aiOn && html`<button type="button" class="btn" disabled=${asking || saving} onClick=${suggest}>${asking ? '✨ היועץ חושב…' : '✨ שהיועץ יציע לכולם'}</button>`}
      <div class="list">${groups.map((g) => html`<div class="sort-row" key=${g.key} style="display:flex;flex-direction:column;gap:6px;padding:10px 0;border-bottom:1px solid var(--line)">
        <span style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.description}</b>
          <span class="num muted" style="font-size:13px;white-space:nowrap">${g.ids.length > 1 ? g.ids.length + ' × · ' : ''}${g.type === 'income' ? '+' : ''}${money(g.total)}</span></span>
        <select class="input" aria-label=${'קטגוריה ל' + g.description} value=${valueOf(picks[g.key])} onChange=${(e) => choose(g, e.target.value)}>
          <option value="">בחרו קטגוריה</option>
          ${roots(g.type).map((r) => [html`<option value=${r.id}>${r.name}</option>`, ...kids(r.id).map((c) => html`<option value=${c.id}>— ${c.name}</option>`)])}
        </select>
      </div>`)}</div>
      <button type="button" class="btn" disabled=${!chosen.length || saving} onClick=${save}>${saving ? 'שומר…' : chosen.length ? 'לשמור ' + chosen.length + ' בתי עסק' : 'בחרו קטגוריה כדי לשמור'}</button>
    </div>`}
  <//>`;
}
