import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { parseItems, grouped } from '../../domain/shopping.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { setGuest, guestCheck } from '../../data/prices.js';
import { AdvisorList } from '../shop/AdvisorList.js';
import { PricePanel } from '../shop/PricePanel.js';

const AISLE_ICON = { produce: 'leaf', bakery: 'bread', dairy: 'milk', meat: 'fish', dry: 'jar', frozen: 'snow', drinks: 'cup', clean: 'drop', care: 'drop', baby: 'baby', other: 'cart' };
const key = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const load = () => { try { const l = JSON.parse(readLocal('guest:list', '[]')); return Array.isArray(l) ? l : []; } catch (_e) { return []; } };

// The token from "#/guest/<token>", or null.
export function guestToken(hash) {
  const m = /^#\/guest\/([A-Za-z0-9_-]{32})$/.exec(String(hash || ''));
  return m ? m[1] : null;
}

// The shopping tab by a link, for one person without an account: a list of
// their own (kept in this browser only), the advisor's list for the week,
// and the price comparison. Nothing else of the app is reachable from here.
export function GuestShop({ token }) {
  const [state, setState] = useState('checking');
  const [label, setLabel] = useState('');
  const [items, setItemsState] = useState(load);
  const [text, setText] = useState('');
  const [advisor, setAdvisor] = useState(false);
  const [prices, setPrices] = useState(false);
  const [people, setPeopleState] = useState(() => Number(readLocal('guest:people', '')) || 2);
  const input = useRef(null);
  useEffect(() => {
    setGuest(token);
    guestCheck().then((r) => { setLabel(r.label || ''); setState('ok'); }).catch(() => setState('off'));
    return () => setGuest(null);
  }, [token]);
  const save = (next) => { setItemsState(next); writeLocal('guest:list', JSON.stringify(next)); };
  const add = (list) => {
    const have = new Set(items.filter((i) => !i.cleared_at).map((i) => key(i.name)));
    const now = new Date().toISOString();
    const fresh = list.filter((x) => x.name && !have.has(key(x.name))).map((x, n) => ({ id: 'g' + Date.now().toString(36) + n, name: x.name, qty: x.qty || null, aisle: x.aisle || 'other', done: false, created_at: now, cleared_at: null }));
    save([...items, ...fresh]);
    return fresh.length;
  };
  const submit = (e) => { e.preventDefault(); if (!text.trim()) return; add(parseItems(text)); setText(''); if (input.current) input.current.focus(); };
  const toggle = (it) => save(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)));
  const remove = (it) => save(items.filter((x) => x.id !== it.id));
  const finish = () => { const at = new Date().toISOString(); save(items.map((x) => (x.done && !x.cleared_at ? { ...x, cleared_at: at } : x))); };
  const setPeople = (n) => { setPeopleState(n); writeLocal('guest:people', String(n)); };

  if (state === 'checking') return html`<main class="guest-shop"><span class="muted">טוען…</span></main>`;
  if (state === 'off') {
    return html`<main class="guest-shop"><div class="card empty" role="alert"><b style="color:var(--text)">הקישור לא פעיל</b>
      <span>ייתכן שהקישור בוטל. אפשר לבקש קישור חדש ממי ששלח אותו.</span></div></main>`;
  }
  const open = items.filter((i) => !i.cleared_at);
  const groups = grouped(items);
  const bought = open.filter((i) => i.done).length;
  return html`<main class="guest-shop stack">
    <header class="guest-head"><h1>רשימת קניות</h1><span class="muted">${label ? 'קישור אישי: ' + label + ' · ' : ''}הרשימה נשמרת רק בדפדפן הזה</span></header>
    <form class="shop-add" onSubmit=${submit}>
      <input ref=${input} class="input" value=${text} onInput=${(e) => setText(e.target.value)} maxLength="300" aria-label="מה להוסיף לרשימה" placeholder="מה להוסיף? אפשר כמה ביחד: חלב, 2 ביצים, לחם" />
      <button type="submit" class="btn" disabled=${!text.trim()}>להוסיף</button>
    </form>
    <button type="button" class="card adv-cta" onClick=${() => setAdvisor(true)}><span class="adv-spark" aria-hidden="true"><${Icon} name="spark" size=${18} /></span><span><b>היועץ ממליץ: רשימה לשבוע</b><small class="muted">לפי מספר הנפשות בבית. עורכים ומוסיפים בלחיצה.</small></span><span aria-hidden="true">‹</span></button>
    ${advisor && html`<${AdvisorList} items=${items} people=${people} onPeople=${setPeople} onClose=${() => setAdvisor(false)} onAdd=${(list) => add(list)} />`}
    ${prices && html`<${PricePanel} guest hid="guest" items=${items} onClose=${() => setPrices(false)} onPicked=${(id, barcode) => save(items.map((x) => (x.id === id ? { ...x, barcode } : x)))} />`}
    ${!prices && open.some((i) => !i.done) && html`<div class="card stack shop-prices-cta"><b>איפה הכי זול לקנות את הרשימה?</b>
      <span class="muted" style="font-size:14px">משווים את הרשימה בין הרשתות, לפי המחירים שהן מפרסמות.</span>
      <button type="button" class="btn" onClick=${() => setPrices(true)}>להשוות מחירים</button></div>`}
    ${open.length === 0 && html`<div class="card empty shop-empty"><b style="color:var(--text)">הרשימה ריקה</b><span>כותבים למעלה מה צריך, או נותנים ליועץ להציע רשימה לשבוע.</span></div>`}
    ${groups.map((g) => html`<div class="shop-group" key=${g.aisle}>
      <h2 class="shop-aisle"><${Icon} name=${AISLE_ICON[g.aisle] || 'cart'} size=${15} stroke=${1.8} />${g.label}<span class="shop-aisle-n">${g.items.filter((i) => !i.done).length || ''}</span></h2>
      <div class="card shop-items">
        ${g.items.map((i) => html`<div class=${'shop-item' + (i.done ? ' done' : '')} key=${i.id}>
          <label class="shop-check"><input type="checkbox" checked=${i.done} onChange=${() => toggle(i)} aria-label=${(i.done ? 'בוטל סימון: ' : 'נקנה: ') + i.name} /><span class="shop-name">${i.name}</span></label>
          ${i.qty && html`<span class="shop-qty">${i.qty}</span>`}
          <button type="button" class="icon-btn shop-del" aria-label=${'להוריד את ' + i.name + ' מהרשימה'} onClick=${() => remove(i)}><${Icon} name="x" size=${15} /></button>
        </div>`)}
      </div>
    </div>`)}
    ${bought > 0 && html`<button type="button" class="btn shop-finish" onClick=${finish}>סיימתי לקנות (${bought} נקנו)</button>`}
  </main>`;
}
