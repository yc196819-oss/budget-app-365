import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { AISLES } from '../../domain/shopping.js';
import { qtyText, toItems, alreadyOn } from '../../domain/shopList.js';
import { chooseAll, basket, count, nearby, withoutChains, hiddenChains, chainNote } from '../../domain/prices.js';
import { searchPrices, getKosherPref, getArea } from '../../data/prices.js';
import { addItems } from '../../data/shopping.js';
import { money } from '../../domain/format.js';
import { track } from '../../lib/telemetry.js';

// The advisor's shopping list, inside the conversation: the number of people
// (the amounts follow it at once), a check for each line, what it would cost
// at the cheapest chain, and one tap to add it to "קניות". Nothing is added
// until that tap.
export function ShopListCard({ list, hid, people: homePeople, onList = [] }) {
  const [people, setPeople] = useState(list.people || homePeople || 4);
  const [checked, setChecked] = useState(() => new Set(list.items.filter((i) => !alreadyOn(i.name, onList)).map((i) => i.name)));
  const [state, setState] = useState(null); // null | 'adding' | { added } | { error }
  const [cost, setCost] = useState(null); // null | 'loading' | { name, total, missing, of } | { error }
  const items = toItems(list, people, checked, onList);
  const toggle = (name) => setChecked((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const resize = (v) => { setPeople(Math.max(1, Math.min(30, v))); setCost(null); };
  const groups = AISLES.map((a) => ({ ...a, rows: list.items.filter((i) => i.aisle === a.key) })).filter((g) => g.rows.length);
  const have = list.items.filter((i) => alreadyOn(i.name, onList)).map((i) => i.name);

  const estimate = async () => {
    setCost('loading');
    track('advisor_list_cost');
    try {
      const [catalog, pref, area] = await Promise.all([searchPrices(items.map((i) => i.name)), getKosherPref(hid).catch(() => null), getArea(hid).catch(() => null)]);
      const lines = items.map((it, n) => ({ id: 'l' + n, name: it.name, qty: it.qty }));
      const choices = chooseAll(lines, withoutChains(nearby(catalog, !!area, area ? area.stores : null), hiddenChains(pref)), pref || 'any');
      const rows = basket(choices, (c) => count((lines.find((l) => l.id === c.id) || {}).qty, c.pick));
      const best = rows.find((r) => !chainNote(r.chain)) || rows[0];
      setCost(best ? { name: best.name, total: best.total, missing: best.missing, of: lines.length } : { error: 'לא מצאנו מחירים למוצרים האלה.' });
    } catch (_e) { setCost({ error: 'לא הצלחנו לחשב עכשיו. נסו שוב.' }); }
  };
  const add = async () => {
    setState('adding');
    try {
      await addItems(hid, items);
      track('advisor_list_add');
      setState({ added: items.length });
    } catch (_e) { setState({ error: 'לא נשמר. נסו שוב.' }); }
  };

  return html`<div class="sl card">
    <div class="sl-h"><b>${list.title}</b>${list.kosher && html`<span class="sl-tag">כשר: ${list.kosher}</span>`}</div>
    <div class="sl-ppl"><span>כמה אנשים</span>
      <span class="pic-step" role="group" aria-label="כמה אנשים"><button type="button" aria-label="פחות" onClick=${() => resize(people - 1)} disabled=${people <= 1}>−</button><b class="num" aria-live="polite">${people}</b><button type="button" aria-label="עוד אחד" onClick=${() => resize(people + 1)} disabled=${people >= 30}>+</button></span></div>
    ${groups.map((g) => html`<div class="sl-grp" key=${g.key}><small>${g.label}</small>
      ${g.rows.map((it) => { const on = alreadyOn(it.name, onList); return html`<label class=${'sl-row' + (checked.has(it.name) && !on ? '' : ' off')} key=${it.name}>
        <input type="checkbox" checked=${checked.has(it.name) && !on} disabled=${on} onChange=${() => toggle(it.name)} aria-label=${it.name} />
        <span class="sl-n">${it.name}</span>
        ${!on && (it.qty != null || it.unit) ? html`<span class=${'sl-q num' + (it.scale && people !== list.people ? ' ch' : '')}>${qtyText(it, people, list.people)}</span>` : ''}
      </label>`; })}
    </div>`)}
    ${have.length > 0 && html`<span class="sl-have">כבר ברשימה שלכם: ${have.join(', ')}. לא יתווספו שוב.</span>`}
    ${cost === null && items.length > 0 && html`<button type="button" class="btn-text sl-cost-btn" onClick=${estimate}>כמה זה יעלה ברשת הכי זולה?</button>`}
    ${cost === 'loading' && html`<span class="sl-cost muted" role="status">בודק מחירים ברשתות…</span>`}
    ${cost && cost.total != null && html`<span class="sl-cost" role="status">בערך <b class="num">${money(cost.total)}</b> ב${cost.name}${cost.missing ? ' (בלי ' + (cost.missing === 1 ? 'מוצר אחד שלא מצאנו' : cost.missing + ' מוצרים שלא מצאנו') + ')' : ''}. ההשוואה המלאה ב"קניות".</span>`}
    ${cost && cost.error && html`<span class="sl-cost muted" role="alert">${cost.error}</span>`}
    ${state && state.added != null
      ? html`<span class="sl-done" role="status"><${Icon} name="check" size=${16} /> נוספו ${state.added === 1 ? 'פריט אחד' : state.added + ' פריטים'} ל"קניות"</span>`
      : html`<button type="button" class="btn" disabled=${!items.length || state === 'adding'} onClick=${add}>${state === 'adding' ? 'מוסיף…' : 'להוסיף ל"קניות" (' + items.length + ')'}</button>`}
    ${state && state.error && html`<span class="adv-err" role="alert">${state.error}</span>`}
    <small class="sl-hint">רוצים לשנות? כתבו ליועץ, למשל "בלי בשר" או "תוסיף סלטים"</small>
  </div>`;
}
