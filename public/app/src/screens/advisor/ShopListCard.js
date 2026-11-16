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

// The advisor's shopping list: the number of people typed in (the amounts
// follow it), the products as tiles (several in a row on a computer, two on a
// phone), a department at a time, and a checkout bar with what the cart costs
// at the cheapest chain. A tile slid aside (or ✕) leaves the cart and can be
// put back. Nothing is added to "קניות" until the button.
export function ShopListCard({ list, hid, people: homePeople, onList = [] }) {
  const [people, setPeople] = useState(list.people || homePeople || 4);
  const [typed, setTyped] = useState(String(list.people || homePeople || 4));
  const inCart = list.items.filter((i) => !alreadyOn(i.name, onList));
  const [out, setOut] = useState(() => new Set());
  const [aisle, setAisle] = useState('all');
  const [state, setState] = useState(null); // null | 'adding' | { added } | { error }
  // The chains' prices for these products, read once; the cost is worked out
  // again here on every change (no waiting).
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
    const rows = basket(chooseAll(lines, cat, prices.pref || 'any'), (c) => count((lines.find((l) => l.id === c.id) || {}).qty, c.pick));
    const best = rows.find((r) => !chainNote(r.chain)) || rows[0];
    return best ? { name: best.name, total: best.total, found: items.length - best.missing } : null;
  }, [prices, people, out.size]);

  const type = (v) => {
    setTyped(v);
    const n = Math.round(Number(v));
    if (n >= 1 && n <= 30) setPeople(n);
  };
  const aisles = AISLES.filter((a) => inCart.some((i) => i.aisle === a.key));
  const shown = inCart.filter((i) => aisle === 'all' || i.aisle === aisle);
  const take = (name) => { setOut((s) => new Set([...s, name])); track('advisor_list_out'); };
  const back = (name) => setOut((s) => { const n = new Set(s); n.delete(name); return n; });
  const add = async () => {
    setState('adding');
    try { await addItems(hid, items); track('advisor_list_add'); setState({ added: items.length }); }
    catch (_e) { setState({ error: 'לא נשמר. נסו שוב.' }); }
  };
  const have = list.items.filter((i) => alreadyOn(i.name, onList)).map((i) => i.name);

  return html`<div class="cart-card">
    <div class="cart-head">
      <div class="cart-title"><b>${list.title}</b>${list.kosher && html`<span class="cart-tag">כשר: ${list.kosher}</span>`}</div>
      <label class="cart-people">ל-<input class="cart-num num" type="number" inputmode="numeric" min="1" max="30" value=${typed} aria-label="כמה אנשים"
        onInput=${(e) => type(e.currentTarget.value)} onBlur=${() => setTyped(String(people))} /> ${people === 1 ? 'איש' : 'אנשים'}</label>
    </div>
    ${aisles.length > 1 && html`<div class="cart-chips" role="tablist">
      <button type="button" role="tab" aria-selected=${String(aisle === 'all')} onClick=${() => setAisle('all')}>הכל <span class="num">${inCart.length}</span></button>
      ${aisles.map((a) => html`<button type="button" role="tab" key=${a.key} aria-selected=${String(aisle === a.key)} onClick=${() => setAisle(a.key)}>${a.label}</button>`)}
    </div>`}
    <div class="cart-grid">
      ${shown.map((it) => (out.has(it.name)
        ? html`<button type="button" class="cart-tile gone" key=${it.name} onClick=${() => back(it.name)}><span class="cart-n">${it.name}</span><span class="cart-back">להחזיר</span></button>`
        : html`<${Tile} key=${it.name} name=${it.name} qty=${qtyText(it, people, list.people)} changed=${it.scale && people !== list.people} onOut=${() => take(it.name)} />`))}
    </div>
    ${have.length > 0 && html`<span class="cart-have">כבר ברשימה שלכם: ${have.join(', ')}. לא יתווספו שוב.</span>`}
    ${state && state.added != null
      ? html`<div class="cart-done" role="status"><${Icon} name="check" size=${18} /> נוספו ${state.added === 1 ? 'פריט אחד' : state.added + ' פריטים'} ל"קניות"</div>`
      : html`<div class="cart-pay">
        <span class="cart-sum" role="status" aria-live="polite">
          ${prices === 'loading' ? html`<small>בודק מחירים ברשתות…</small>`
            : cost ? html`<b class="num">≈ ${money(cost.total)}</b><small>ב${cost.name} · ${cost.found === items.length ? items.length + ' מוצרים' : cost.found + ' מתוך ' + items.length + ' נמצאו'}</small>`
            : html`<b class="num">${items.length} מוצרים</b><small>${items.length ? 'לא מצאנו מחירים' : 'העגלה ריקה'}</small>`}
        </span>
        <button type="button" class="cart-add" disabled=${!items.length || state === 'adding'} onClick=${add}>${state === 'adding' ? 'מוסיף…' : html`להוסיף ל"קניות" <${Icon} name="plus" size=${16} />`}</button>
      </div>`}
    ${state && state.error && html`<span class="adv-err" role="alert">${state.error}</span>`}
    <small class="cart-hint">מחליקים מוצר הצידה (או ✕) כדי להוציא אותו. רוצים לשנות? כתבו ליועץ, למשל "בלי בשר"</small>
  </div>`;
}

// One product: slid aside (more than a third of its width) it leaves the
// cart; the ✕ does the same for a mouse or a keyboard.
function Tile({ name, qty, changed, onOut }) {
  const [dx, setDx] = useState(0);
  const start = useRef(null);
  const down = (e) => {
    if (e.target.closest('button')) return;
    start.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.offsetWidth };
    // Followed past the tile's edge (a tile is narrow).
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_e) { /* not supported */ }
  };
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
  return html`<div class="cart-tile" style=${dx ? 'transform:translateX(' + dx + 'px) rotate(' + (dx / 40) + 'deg);opacity:' + Math.max(0.2, 1 - Math.abs(dx) / 220) : ''}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
    <span class="cart-n">${name}</span>
    ${qty ? html`<span class=${'cart-q num' + (changed ? ' ch' : '')} key=${qty}>${qty}</span>` : html`<span class="cart-q"></span>`}
    <button type="button" class="cart-x" aria-label=${'להוציא ' + name} onClick=${onOut}><${Icon} name="x" size=${14} /></button>
  </div>`;
}
