import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { suggestList } from '../../domain/shopping.js';
import { setPeople } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// The advisor's list for the week (the owner tries it first): what this home
// buys again and again, then the basics sized for the people at home. Each
// line can be unchecked or its amount changed before it goes on the list.
export function AdvisorList({ items, people, onAdd, onClose }) {
  const [n, setN] = useState(people || 2);
  const [rows, setRows] = useState(() => suggestList({ items, people: people || 2 }).map((r) => ({ ...r, on: true })));
  const resize = (v) => {
    const next = Math.max(1, Math.min(20, v));
    setN(next);
    // New amounts for the basics; what was unchecked stays unchecked.
    const off = new Set(rows.filter((r) => !r.on).map((r) => r.name));
    setRows(suggestList({ items, people: next }).map((r) => ({ ...r, on: !off.has(r.name) })));
    setPeople(next).catch(() => {});
  };
  const chosen = rows.filter((r) => r.on);
  const set = (i, patch) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return html`<${Sheet} title="היועץ ממליץ: רשימה לשבוע" onClose=${onClose}>
    <div class="stack adv-list">
      <div class="adv-people"><span>כמה גרים בבית?</span>
        <span class="pic-step" role="group" aria-label="כמה גרים בבית"><button type="button" aria-label="פחות" onClick=${() => resize(n - 1)} disabled=${n <= 1}>−</button><b class="num" aria-live="polite">${n}</b><button type="button" aria-label="עוד אחד" onClick=${() => resize(n + 1)} disabled=${n >= 20}>+</button></span></div>
      <p class="muted" style="margin:0;font-size:13.5px;line-height:1.55">קודם מה שאתם קונים בדרך כלל, ואחר כך הבסיס לשבוע לפי מספר הנפשות. מורידים סימון ממה שלא צריך, ואפשר לשנות כמויות.</p>
      <ul class="adv-rows">${rows.map((r, i) => html`<li key=${r.name} class=${r.on ? '' : 'off'}>
        <label><input type="checkbox" checked=${r.on} onChange=${() => set(i, { on: !r.on })} aria-label=${r.name} /><span><b>${r.name}</b><small class="muted">${r.why}</small></span></label>
        <input class="input adv-qty" value=${r.qty || ''} placeholder="כמות" aria-label=${'כמות ' + r.name} maxLength="20" onInput=${(e) => set(i, { qty: e.currentTarget.value })} />
      </li>`)}</ul>
      <button type="button" class="btn" disabled=${!chosen.length} onClick=${() => { onAdd(chosen.map(({ name, qty, aisle }) => ({ name, qty: qty ? qty.trim() : null, aisle }))); onClose(); }}><${Icon} name="plus" size=${16} />להוסיף לרשימה (${chosen.length})</button>
    </div>
  <//>`;
}
