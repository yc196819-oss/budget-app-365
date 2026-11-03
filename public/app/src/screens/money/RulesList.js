import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { listRules, setRuleCategory, deleteRule } from '../../data/rules.js';
import { snapshot } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';
import { Icon } from '../../components/Icon.js';

// The household's category rules: see them, change the category, delete one.
// Deleting a rule changes no saved transaction; it only stops filing new ones.
export function RulesList({ categories, kind, members = {} }) {
  const hid = snapshot().hid;
  const me = snapshot().userId;
  const [rules, setRules] = useState(null);
  const [sure, setSure] = useState(null);
  useEffect(() => { if (hid) listRules(hid).then(setRules).catch(() => setRules([])); }, [hid]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const nameOf = (r) => { const c = byId.get(r.category_id); const s = byId.get(r.subcategory_id); return c ? c.name + (s ? ' · ' + s.name : '') : 'קטגוריה שנמחקה'; };
  const options = categories.filter((c) => (c.kind || 'expense') === kind && !c.parent_id)
    .flatMap((c) => [{ value: c.id + '|', label: c.name }, ...categories.filter((s) => s.parent_id === c.id).map((s) => ({ value: c.id + '|' + s.id, label: c.name + ' · ' + s.name }))]);
  const who = (r) => (r.created_by === me ? 'נוצר אצלך' : members[r.created_by] ? 'נוצר אצל ' + members[r.created_by] : '');
  const change = async (r, value) => {
    const [cat, sub] = value.split('|');
    try { await setRuleCategory(hid, r.id, cat, sub || null); setRules((l) => l.map((x) => (x.id === r.id ? { ...x, category_id: cat, subcategory_id: sub || null } : x))); showToast('הכלל עודכן'); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  const remove = async (r) => {
    if (sure !== r.id) { setSure(r.id); return; }
    try { await deleteRule(hid, r.id); setRules((l) => l.filter((x) => x.id !== r.id)); setSure(null); showToast('הכלל נמחק'); } catch (_e) { showToast('המחיקה נכשלה. נסו שוב.'); }
  };
  const mine = (rules || []).filter((r) => r.type === kind);
  return html`<section class="stack rules-list" aria-labelledby="rules-h" style="gap:8px">
    <h3 id="rules-h" class="section-h" style="margin:0">כללי סיווג</h3>
    <span class="muted" style="font-size:14px;line-height:1.55">כל תנועה מבית עסק ברשימה מסווגת לבד, לפני ה-AI. שניכם משתמשים באותם כללים. מחיקה לא משנה תנועות שכבר נשמרו.</span>
    ${rules === null && html`<div class="skel-row"><span class="skel" style="width:60%"></span></div>`}
    ${rules && mine.length === 0 && html`<span class="muted" style="font-size:14px">אין עדיין כללים. הם נוצרים כשמשנים קטגוריה לתנועה ולוחצים "כן, תמיד".</span>`}
    ${mine.map((r) => html`<div class="rule-row" key=${r.id}>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><b>${r.label || r.match}</b>
        <span class="muted" style="font-size:14px">← ${nameOf(r)}${who(r) ? ' · ' + who(r) : ''}</span></span>
      <select class="input rule-pick" aria-label=${'קטגוריה לכלל של ' + (r.label || r.match)} value=${r.category_id + '|' + (r.subcategory_id || '')} onChange=${(e) => change(r, e.target.value)}>
        ${options.map((o) => html`<option value=${o.value}>${o.label}</option>`)}
      </select>
      <button type="button" class=${'icon-btn rule-del' + (sure === r.id ? ' sure' : '')} aria-label=${sure === r.id ? 'בטוח? למחוק את הכלל' : 'למחוק את הכלל של ' + (r.label || r.match)} onClick=${() => remove(r)}>${sure === r.id ? 'בטוח?' : html`<${Icon} name="x" size=${18} />`}</button>
    </div>`)}
  </section>`;
}
