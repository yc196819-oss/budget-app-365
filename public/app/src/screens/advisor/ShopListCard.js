import { html } from '../../lib/html.js';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { AISLES } from '../../domain/shopping.js';
import { qtyText, toItems, alreadyOn } from '../../domain/shopList.js';
import { chooseAll, basket, count, nearby, withoutChains, hiddenChains, chainNote } from '../../domain/prices.js';
import { searchPrices, getKosherPref, getArea } from '../../data/prices.js';
import { addItems } from '../../data/shopping.js';
import { money } from '../../domain/format.js';
import { track } from '../../lib/telemetry.js';

// The advisor's shopping list as a cart: what it costs at the cheapest chain
// in the middle (it changes as the cart does), a slider for how many people,
// the departments to look at one at a time, and a line slid aside (or ✕) is
// taken out of the cart and can be put back. Nothing is added to "קניות"
// until the button.
export function ShopListCard({ list, hid, people: homePeople, onList = [] }) {
  const [people, setPeople] = useState(list.people || homePeople || 4);
  const inCart = list.items.filter((i) => !alreadyOn(i.name, onList));
  const [out, setOut] = useState(() => new Set());
  const [aisle, setAisle] = useState('all');
  const [state, setState] = useState(null); // null | 'adding' | { added } | { error }
  // The chains' prices for these products, read once; the cart's cost is
  // worked out again here on every change (no waiting).
  const [prices, setPrices] = useState('loading'); // 'loading' | { catalog, pref, area } | 'none'
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    Promise.all([searchPrices(inCart.map((i) => i.name)), getKosherPref(hid).catch(() => null), getArea(hid).catch(() => null)])
      .then(([catalog, pref, area]) => { if (alive.current) setPrices({ catalog, pref, area }); })
      .catch(() => { if (alive.current) setPrices('none'); });
    return () => { alive.current = false; };
  }, []);

  const checked = new Set(inCart.map((i) => i.name).filter((n) => !out.has(n)));
  const items = toItems(list, people, checked, onList);
  const cost = useMemo(() => {
    if (!prices || typeof prices !== 'object' || !items.length) return null;
    const lines = items.map((it, n) => ({ id: 'l' + n, name: it.name, qty: it.qty }));
    const cat = withoutChains(nearby(prices.catalog, !!prices.area, prices.area ? prices.area.stores : null), hiddenChains(prices.pref));
    const choices = chooseAll(lines, cat, prices.pref || 'any');
    const rows = basket(choices, (c) => count((lines.find((l) => l.id === c.id) || {}).qty, c.pick));
    const best = rows.find((r) => !chainNote(r.chain)) || rows[0];
    return best ? { name: best.name, total: best.total, found: items.length - best.missing, of: items.length } : { none: true };
  }, [prices, people, out.size]);

  const aisles = AISLES.filter((a) => inCart.some((i) => i.aisle === a.key));
  const shown = inCart.filter((i) => !out.has(i.name) && (aisle === 'all' || i.aisle === aisle));
  const removed = inCart.filter((i) => out.has(i.name));
  const take = (name) => { setOut((s) => new Set([...s, name])); track('advisor_list_out'); };
  const back = (name) => setOut((s) => { const n = new Set(s); n.delete(name); return n; });
  const add = async () => {
    setState('adding');
    try { await addItems(hid, items); track('advisor_list_add'); setState({ added: items.length }); }
    catch (_e) { setState({ error: 'לא נשמר. נסו שוב.' }); }
  };
  const pct = cost && cost.of ? Math.round((cost.found / cost.of) * 100) : 0;

  return html`<div class="cart-card">
    <div class="cart-top"><b>${list.title}</b>${list.kosher && html`<span class="cart-tag">כשר: ${list.kosher}</span>`}</div>
    <div class="cart-ring" style=${'--p:' + (prices === 'loading' ? 0 : pct)} role="status" aria-live="polite">
      <div class="cart-ring-in">
        ${prices === 'loading' ? html`<small>בודק מחירים…</small>`
          : cost && cost.total != null ? html`<small>העגלה בערך</small><b class="num">${money(cost.total)}</b><small>ב${cost.name} · ${cost.found === cost.of ? cost.of + ' מוצרים' : cost.found + ' מתוך ' + cost.of + ' נמצאו'}</small>`
          : html`<small>${items.length ? 'לא מצאנו מחירים' : 'העגלה ריקה'}</small><b>${items.length}</b><small>מוצרים</small>`}
      </div>
    </div>
    <div class="cart-ppl">
      <button type="button" class="cart-step" aria-label="פחות" onClick=${() => setPeople((p) => Math.max(1, p - 1))} disabled=${people <= 1}>−</button>
      <input type="range" min="1" max="20" value=${people} aria-label="כמה אנשים" onInput=${(e) => setPeople(Number(e.currentTarget.value))} style=${'--v:' + ((people - 1) / 19 * 100) + '%'} />
      <button type="button" class="cart-step" aria-label="עוד אחד" onClick=${() => setPeople((p) => Math.min(20, p + 1))} disabled=${people >= 20}>+</button>
      <b class="cart-ppl-n num">${people} ${people === 1 ? 'איש' : 'אנשים'}</b>
    </div>
    ${aisles.length > 1 && html`<div class="cart-chips" role="tablist">
      <button type="button" role="tab" aria-selected=${String(aisle === 'all')} onClick=${() => setAisle('all')}>הכל</button>
      ${aisles.map((a) => html`<button type="button" role="tab" key=${a.key} aria-selected=${String(aisle === a.key)} onClick=${() => setAisle(a.key)}>${a.label}</button>`)}
    </div>`}
    <div class="cart-rows">
      ${shown.map((it) => html`<${Row} key=${it.name} name=${it.name} qty=${qtyText(it, people, list.people)} changed=${it.scale && people !== list.people} onOut=${() => take(it.name)} />`)}
      ${removed.map((it) => html`<button type="button" class="cart-gone" key=${'g' + it.name} onClick=${() => back(it.name)}>${it.name} הוצא מהעגלה · <u>להחזיר</u></button>`)}
    </div>
    ${list.items.length > inCart.length && html`<span class="cart-have">כבר ברשימה שלכם: ${list.items.filter((i) => alreadyOn(i.name, onList)).map((i) => i.name).join(', ')}. לא יתווספו שוב.</span>`}
    ${state && state.added != null
      ? html`<span class="cart-done" role="status"><${Icon} name="check" size=${16} /> נוספו ${state.added === 1 ? 'פריט אחד' : state.added + ' פריטים'} ל"קניות"</span>`
      : html`<button type="button" class="cart-add" disabled=${!items.length || state === 'adding'} onClick=${add}><span>${state === 'adding' ? 'מוסיף…' : 'להוסיף ל"קניות"'}</span><span class="num">${items.length} מוצרים</span></button>`}
    ${state && state.error && html`<span class="adv-err" role="alert">${state.error}</span>`}
    <small class="cart-hint">מחליקים שורה הצידה כדי להוציא אותה. רוצים לשנות? כתבו ליועץ, למשל "בלי בשר"</small>
  </div>`;
}

// One line of the cart: slid aside (more than a third of its width) it is
// taken out; the ✕ does the same for a mouse or a keyboard.
function Row({ name, qty, changed, onOut }) {
  const [dx, setDx] = useState(0);
  const start = useRef(null);
  const down = (e) => { start.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.offsetWidth }; };
  const move = (e) => {
    if (!start.current) return;
    const d = e.clientX - start.current.x;
    if (Math.abs(e.clientY - start.current.y) > 24 && Math.abs(d) < 12) { start.current = null; setDx(0); return; }
    setDx(d);
  };
  const up = () => {
    if (!start.current) return;
    const far = Math.abs(dx) > start.current.w / 3;
    start.current = null;
    if (far) onOut(); else setDx(0);
  };
  return html`<div class="cart-row" style=${dx ? 'transform:translateX(' + dx + 'px);opacity:' + Math.max(0.2, 1 - Math.abs(dx) / 260) : ''}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
    <span class="cart-n">${name}</span>
    ${qty ? html`<span class=${'cart-q num' + (changed ? ' ch' : '')} key=${qty}>${qty}</span>` : ''}
    <button type="button" class="cart-x" aria-label=${'להוציא ' + name} onClick=${onOut}><${Icon} name="x" size=${14} /></button>
  </div>`;
}
