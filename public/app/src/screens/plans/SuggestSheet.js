import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { suggestBudget } from '../../domain/goals.js';
import { setBudget } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// A budget for every category that has none: the household's own average
// less 5%. Each line can be changed or left out before saving.
export function SuggestSheet({ rows, months, onClose }) {
  const [lines, setLines] = useState(() => rows.map((c) => ({ id: c.id, name: c.name, icon: c.icon, avg: c.avg, amount: String(suggestBudget(c.avg)), on: true })));
  const [busy, setBusy] = useState(false);
  const chosen = lines.filter((l) => l.on && toNumber(l.amount) > 0);
  const total = chosen.reduce((s, l) => s + toNumber(l.amount), 0);
  const set = (id, patch) => setLines((all) => all.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const save = async () => {
    if (busy || !chosen.length) return;
    setBusy(true);
    try {
      for (const l of chosen) await setBudget(l.id, Math.round(toNumber(l.amount)));
      showToast('נשמר תקציב ל-' + (chosen.length === 1 ? 'קטגוריה אחת' : chosen.length + ' קטגוריות') + ': ' + money(total) + ' בחודש');
      onClose();
    } catch (_e) { showToast('השמירה נכשלה. נסו שוב.'); setBusy(false); }
  };
  return html`<${Sheet} title="תקציב לפי הממוצע שלכם" onClose=${onClose}>
    <span class="muted" style="font-size:14px;line-height:1.55">לכל קטגוריה: מה שהוצאתם בממוצע ב${months === 1 ? 'חודש האחרון' : '-' + months + ' החודשים האחרונים'}, והצעה קצת מתחתיו. אפשר לשנות סכום או להוריד את הסימון.</span>
    <div class="list suggest-list">
      ${lines.map((l) => html`<div class="suggest-line" key=${l.id}>
        <label class="check" style="flex:1;min-width:0"><input type="checkbox" checked=${l.on} onChange=${(e) => set(l.id, { on: e.target.checked })} />
          <span style="display:flex;flex-direction:column;min-width:0"><b>${l.icon ? l.icon + ' ' : ''}${l.name}</b><span class="faint" style="font-size:13px">ממוצע ${money(l.avg)}</span></span></label>
        <input class="input num" inputmode="numeric" aria-label=${'תקציב ל' + l.name} value=${l.amount} disabled=${!l.on} onInput=${(e) => set(l.id, { amount: e.target.value })} style="width:110px" />
      </div>`)}
    </div>
    <button type="button" class="btn" disabled=${busy || !chosen.length} onClick=${save}>${busy ? 'שומר…' : 'לשמור תקציב של ' + money(total) + ' בחודש'}</button>
  <//>`;
}
