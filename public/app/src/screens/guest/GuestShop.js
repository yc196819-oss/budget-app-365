import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { parseItems, grouped, onList } from '../../domain/shopping.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { pasteList } from '../../lib/pasteList.js';
import { setGuest, guestCheck, guestCall } from '../../data/prices.js';
import { AdvisorList } from '../shop/AdvisorList.js';
import { PricePanel } from '../shop/PricePanel.js';

const AISLE_ICON = { produce: 'leaf', bakery: 'bread', dairy: 'milk', meat: 'fish', dry: 'jar', frozen: 'snow', drinks: 'cup', clean: 'drop', care: 'drop', baby: 'baby', other: 'cart' };
// The list kept in this browser; finished shoppings older than 120 days
// leave it (as on the home's list), so it does not grow for ever.
const KEEP = 120 * 86400000;
const load = () => {
  try {
    const l = JSON.parse(readLocal('guest:list', '[]'));
    return Array.isArray(l) ? l.filter((i) => !i.cleared_at || Date.now() - new Date(i.cleared_at).getTime() < KEEP) : [];
  } catch (_e) { return []; }
};

// The token from "#/guest/<token>", or null.
export function guestToken(hash) {
  const m = /^#\/guest\/([A-Za-z0-9_-]{32})$/.exec(String(hash || ''));
  return m ? m[1] : null;
}

// The shopping tab by a link, for one person without an account: a list of
// their own (kept in this browser only), the advisor's list for the week,
// and the price comparison. Nothing else of the app is reachable from here.
// A home link (the owner's partner): the household's own list, the same
// one the owner sees, refreshed every few seconds. A test link: a list of
// its own, in this browser.
export function GuestShop({ token }) {
  const [state, setState] = useState('checking');
  const [label, setLabel] = useState('');
  const [home, setHome] = useState(false);
  const [items, setItemsState] = useState(load);
  const [text, setText] = useState('');
  const [advisor, setAdvisor] = useState(false);
  const [prices, setPrices] = useState(false);
  const [people, setPeopleState] = useState(() => Number(readLocal('guest:people', '')) || 2);
  const input = useRef(null);
  useEffect(() => {
    setGuest(token);
    guestCheck().then((r) => { setLabel(r.label || ''); setHome(!!r.home); if (r.home) setItemsState([]); setState('ok'); }).catch(() => setState('off'));
    return () => setGuest(null);
  }, [token]);
  // The home's list: read now and every 8 seconds while the page is open.
  const [err, setErr] = useState('');
  const pull = () => guestCall('/items').then((r) => { setItemsState(r.items || []); setErr(''); }).catch(() => setErr('לא הצלחנו לרענן את הרשימה.'));
  useEffect(() => {
    if (state !== 'ok' || !home) return undefined;
    pull();
    const t = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 8000);
    return () => clearInterval(t);
  }, [state, home]);
  const save = (next) => { setItemsState(next); if (!home) writeLocal('guest:list', JSON.stringify(next)); };
  const failed = () => { setErr('לא נשמר. נסו שוב.'); if (home) pull(); };
  const add = (list) => {
    const now = new Date().toISOString();
    // ("קוטג'" and "קוטג" are the same thing, as on the home's list.)
    const wanted = list.filter((x, n) => x.name && !onList(items, x.name) && !list.slice(0, n).some((y) => onList([y], x.name)));
    if (!wanted.length && list.length) setErr(list.length === 1 ? list[0].name + ' כבר ברשימה' : 'הכול כבר ברשימה');
    if (home) {
      if (wanted.length) guestCall('/items', { items: wanted.map((x) => ({ name: x.name, qty: x.qty || null, aisle: x.aisle || 'other' })) }).then((r) => setItemsState((all) => [...all, ...(r.items || [])])).catch(failed);
      return wanted.length;
    }
    const fresh = wanted.map((x, n) => ({ id: 'g' + Date.now().toString(36) + n, name: x.name, qty: x.qty || null, aisle: x.aisle || 'other', done: false, created_at: now, cleared_at: null }));
    save([...items, ...fresh]);
    return fresh.length;
  };
  const submit = (e) => { e.preventDefault(); if (!text.trim()) return; setErr(''); add(parseItems(text)); setText(''); if (input.current) input.current.focus(); };
  const toggle = (it) => {
    save(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)));
    if (home) guestCall('/items/' + it.id, { done: !it.done }, 'PATCH').catch(failed);
  };
  const remove = (it) => {
    save(items.filter((x) => x.id !== it.id));
    if (home) guestCall('/items/' + it.id, null, 'DELETE').catch(failed);
  };
  const finish = () => {
    const at = new Date().toISOString();
    save(items.map((x) => (x.done && !x.cleared_at ? { ...x, cleared_at: at } : x)));
    if (home) guestCall('/finish', {}).catch(failed);
  };
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
    <header class="guest-head"><h1>רשימת קניות</h1><span class="muted">${label ? 'קישור אישי: ' + label + ' · ' : ''}${home ? 'רשימה משותפת של הבית: מה שמוסיפים כאן מופיע גם אצל השני' : 'הרשימה נשמרת רק בדפדפן הזה'}</span></header>
    ${err && html`<span class="muted" role="status">${err}</span>`}
    <form class="shop-add" onSubmit=${submit}>
      <input ref=${input} class="input" value=${text} onInput=${(e) => setText(e.target.value)} onPaste=${(e) => pasteList(e, setText)} maxLength="2000" aria-label="מה להוסיף לרשימה" placeholder="מה להוסיף? אפשר כמה ביחד: חלב, 2 ביצים, לחם" />
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
