import { html } from '../../lib/html.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { CartDraw } from '../../components/CartDraw.js';
import { AISLES } from '../../domain/shopping.js';
import { qtyText, toItems, alreadyOn, mergeItems, recipeItems } from '../../domain/shopList.js';
import { RecipeInput } from '../shop/RecipeInput.js';
import { chooseAll, basket, count, nearby, withoutChains, hiddenChains, chainNote } from '../../domain/prices.js';
import { searchPrices, getKosherPref, getArea } from '../../data/prices.js';
import { addItems } from '../../data/shopping.js';
import { money } from '../../domain/format.js';
import { track } from '../../lib/telemetry.js';

// What the advisor says while it fills the cart (the first time it shows).
const STEPS = ['בודק מה אתם קונים בדרך כלל', 'מתאים לכמות האנשים', 'מסדר לפי מחלקות בסופר'];

// The advisor's shopping list: filled before the person's eyes (one line at
// a time), the number of people typed in (the amounts follow it), a simple
// list by department, and at the bottom what the cart costs at the cheapest
// chain. The prices of each line show only when a chain is opened. A line
// taken out (✕) can be put back. Nothing is added to "קניות" until the button.
export function ShopListCard({ list, hid, people: homePeople, onList = [], build = true, onAdded = null, toList = null }) {
  const start = list.people || homePeople || 4;
  const [people, setPeople] = useState(start);
  const [typed, setTyped] = useState(String(start));
  // Recipes added to this cart (their lines join it; the same product is one line).
  const [extra, setExtra] = useState([]);
  const [adding, setAdding] = useState(false);
  const full = extra.length ? { ...list, items: mergeItems(list.items, extra) } : list;
  const inCart = full.items.filter((i) => !alreadyOn(i.name, onList));
  // Out of the cart: taken out, or "יש לי" (what most homes keep starts so).
  const [out, setOut] = useState(() => new Set(list.items.filter((i) => i.pantry).map((i) => i.name)));
  const [state, setState] = useState(null); // null | 'adding' | { added } | { error }
  // Filling: the steps, then the lines one by one.
  const [step, setStep] = useState(build ? 0 : STEPS.length);
  useEffect(() => {
    if (!build) return undefined;
    const t = setInterval(() => setStep((s) => { if (s >= STEPS.length) { clearInterval(t); return s; } return s + 1; }), 650);
    return () => clearInterval(t);
  }, []);
  const filling = step < STEPS.length;
  // The chains' prices, read once; the cost is worked out here on every change.
  const [prices, setPrices] = useState('loading');
  const [open, setOpen] = useState(null); // the chain whose prices are shown
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    Promise.all([searchPrices(inCart.map((i) => i.name)), getKosherPref(hid).catch(() => null), getArea(hid).catch(() => null)])
      .then(([catalog, pref, area]) => { if (alive.current) setPrices({ catalog, pref, area }); })
      .catch(() => { if (alive.current) setPrices('none'); });
    return () => { alive.current = false; };
  }, [extra.length]);
  const addRecipe = (r) => {
    const more = recipeItems(r, list.people || start);
    setExtra((e) => [...e, ...more]);
    setOut((o) => new Set([...o, ...more.filter((i) => i.pantry).map((i) => i.name)]));
    setAdding(false);
    setPrices('loading');
    track('advisor_list_recipe');
  };

  const checked = new Set(inCart.map((i) => i.name).filter((n) => !out.has(n)));
  const items = toItems(full, people, checked, onList);
  const chains = useMemo(() => {
    if (!prices || typeof prices !== 'object' || !items.length) return [];
    const lines = items.map((it, n) => ({ id: 'l' + n, name: it.name, qty: it.qty }));
    const cat = withoutChains(nearby(prices.catalog, !!prices.area, prices.area ? prices.area.stores : null), hiddenChains(prices.pref));
    const rows = basket(chooseAll(lines, cat, prices.pref || 'any'), (c) => count((lines.find((l) => l.id === c.id) || {}).qty, c.pick, c.query));
    // Cheapest first, the ones open every day before the rest; three at most.
    return [...rows.filter((r) => !chainNote(r.chain)), ...rows.filter((r) => chainNote(r.chain))].slice(0, 3)
      .map((r) => ({ ...r, found: items.length - r.missing, byName: Object.fromEntries((r.lines || []).map((l) => [items[Number(String(l.id).slice(1))].name, l])) }));
  }, [prices, people, out.size, extra.length]);
  const best = chains[0] || null;
  const shownChain = open && chains.find((c) => c.chain === open);

  const type = (v) => { setTyped(v); const n = Math.round(Number(v)); if (n >= 1 && n <= 30) setPeople(n); };
  const groups = AISLES.map((a) => ({ ...a, rows: inCart.filter((i) => i.aisle === a.key) })).filter((g) => g.rows.length);
  const take = (name) => { setOut((s) => new Set([...s, name])); track('advisor_list_out'); };
  const back = (name) => setOut((s) => { const n = new Set(s); n.delete(name); return n; });
  const add = async () => {
    setState('adding');
    try { const listId = toList ? await toList(list) : null; await addItems(hid, items, listId); track('advisor_list_add'); setState({ added: items.length }); if (onAdded) onAdded(listId); }
    catch (_e) { setState({ error: 'לא נשמר. נסו שוב.' }); }
  };
  const have = list.items.filter((i) => alreadyOn(i.name, onList)).map((i) => i.name);
  let n = 0;

  return html`<div class=${'cart-card' + (filling ? ' filling' : '')}>
    <div class="cart-head">
      <div class="cart-title"><b>${list.title}</b>${list.kosher && html`<span class="cart-tag">כשר: ${list.kosher}</span>`}</div>
      <label class="cart-people">ל-<input class="cart-num num" type="number" inputmode="numeric" min="1" max="30" value=${typed} aria-label="כמה אנשים"
        onInput=${(e) => type(e.currentTarget.value)} onBlur=${() => setTyped(String(people))} disabled=${filling} /> ${people === 1 ? 'איש' : 'אנשים'}</label>
    </div>
    ${filling
      ? html`<div class="cart-fill" role="status" aria-live="polite">
          <${CartDraw} />
          <span class="cart-fill-t"><b>היועץ מכין לכם את העגלה…</b>${STEPS.map((s, i) => html`<small key=${i} class=${i < step ? 'done' : i === step ? 'now' : ''}>${i < step ? '✓ ' : ''}${s}</small>`)}</span>
        </div>`
      : html`<div class="cart-list">
          ${groups.map((g) => html`<div class="cart-grp" key=${g.key}><small>${g.label}</small>
            ${g.rows.map((it) => { const i = n++; const gone = out.has(it.name); const line = shownChain && shownChain.byName[it.name];
              const rec = it.from === 'recipe' || it.pantry;
              return html`<div class=${'cl-row' + (gone ? (rec ? ' has' : ' gone') : '')} key=${it.name} style=${'--i:' + i}>
                <span class="cart-n">${it.name}</span>
                ${!gone && html`<span class=${'cart-q num' + (it.scale && people !== start ? ' ch' : '')} key=${people}>${qtyText(it, people, list.people)}</span>`}
                ${!gone && shownChain && html`<span class="cart-p num">${line && line.product ? money(line.cost != null ? line.cost : line.price) : '—'}</span>`}
                ${rec
                  ? html`<button type="button" class=${'cart-home' + (gone ? ' on' : '')} aria-pressed=${String(gone)} aria-label=${'יש לי ' + it.name} onClick=${() => (gone ? back(it.name) : take(it.name))}>${gone ? '✓ יש בבית' : 'יש לי'}</button>`
                  : gone
                  ? html`<button type="button" class="cart-back" onClick=${() => back(it.name)}>להחזיר</button>`
                  : html`<button type="button" class="cart-x" aria-label=${'להוציא ' + it.name} onClick=${() => take(it.name)}><${Icon} name="x" size=${14} /></button>`}
              </div>`; })}
          </div>`)}
        </div>`}
    ${!filling && !(state && state.added != null) && (adding
      ? html`<${RecipeInput} onRecipe=${addRecipe} onCancel=${() => setAdding(false)} />`
      : html`<button type="button" class="cart-more" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15} /> להוסיף מתכון לעגלה</button>`)}
    ${!filling && have.length > 0 && html`<span class="cart-have">כבר ברשימה שלכם: ${have.join(', ')}. לא יתווספו שוב.</span>`}
    ${!filling && shownChain && html`<div class="cart-chains" role="tablist" aria-label="מחירים לפי רשת">${chains.map((c) => html`<button type="button" role="tab" key=${c.chain} aria-selected=${String(c.chain === open)} onClick=${() => setOpen(c.chain)}>
      <b>${c.name}</b><span class="num">${money(c.total)}</span>${c.found < items.length ? html`<small>${c.found} מתוך ${items.length}</small>` : ''}</button>`)}</div>`}
    ${!filling && (state && state.added != null
      ? html`<div class="cart-done" role="status"><${Icon} name="check" size=${18} /> נוספו ${state.added === 1 ? 'פריט אחד' : state.added + ' פריטים'} ל"קניות"</div>`
      : html`<div class="cart-pay">
        <button type="button" class="cart-sum" disabled=${!best} aria-expanded=${String(!!shownChain)} onClick=${() => { setOpen(shownChain ? null : best.chain); if (!shownChain) track('advisor_list_prices'); }}>
          ${prices === 'loading' ? html`<small>בודק מחירים ברשתות…</small>`
            : best ? html`<small>הכי זול: ${best.name}</small><b class="num">≈ ${money(best.total)}</b><small class="cart-open">${shownChain ? 'להסתיר מחירים' : 'לראות מחירים ›'}</small>`
            : html`<b class="num">${items.length} מוצרים</b><small>${items.length ? 'לא מצאנו מחירים' : 'העגלה ריקה'}</small>`}
        </button>
        <button type="button" class="cart-add" disabled=${!items.length || state === 'adding'} onClick=${add}>${state === 'adding' ? 'מוסיף…' : html`להוסיף ל"קניות" (${items.length})`}</button>
      </div>`)}
    ${state && state.error && html`<span class="adv-err" role="alert">${state.error}</span>`}
    ${!filling && html`<small class="cart-hint">רוצים לשנות? כתבו ליועץ, למשל "בלי בשר" או "תוסיף סלטים"</small>`}
  </div>`;
}
