import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { Loading } from '../../components/Loading.js';
import { parseItems, aisleOf, grouped, usual, previousList, onList, listText, perWeek } from '../../domain/shopping.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { categoryRows } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { useShopping, addItems, setDone, removeItem, finishShopping, getArea, setArea } from '../../data/shopping.js';
import { canListen, listen } from '../../lib/speech.js';
import { showToast } from '../../lib/toast.js';
import { track } from '../../lib/telemetry.js';
import { go } from '../../lib/go.js';
import { PricePanel, PriceTeaser } from './PricePanel.js';
import { AdvisorList } from './AdvisorList.js';
import { Receipts } from './Receipts.js';
import { loadReceipts } from '../../data/receipts.js';

// The food budget of this month, from the goals tab: the category named
// food (אוכל / מזון) or the one holding the supermarket.
function foodBudget(data, today) {
  const food = data.categories.find((c) => !c.parent_id && /אוכל|מזון/.test(c.name))
    || data.categories.find((c) => !c.parent_id && data.categories.some((s) => s.parent_id === c.id && /סופר/.test(s.name)));
  if (!food) return null;
  const b = data.budgets.find((x) => x.category_id === food.id);
  const budget = b ? Number(b.monthly_amount) || 0 : 0;
  if (!budget) return null;
  const row = categoryRows(data.txs, data.categories, data.budgets, [{ y: today.getFullYear(), m: today.getMonth() }]).find((r) => r.id === food.id);
  const spent = row ? row.spent : 0;
  return { name: food.name, budget, spent, left: budget - spent };
}


const AISLE_ICON = { produce: 'leaf', bakery: 'bread', dairy: 'milk', meat: 'fish', dry: 'jar', frozen: 'snow', drinks: 'cup', clean: 'drop', care: 'drop', baby: 'baby', other: 'cart' };

// What this tab is for, the first time (and again from "מה זה?"): not just a
// list, help to spend less at the supermarket.
const INTRO_KEY = 'shop:intro-seen';
const BENEFITS = [
  ['cart', 'לא קונים פעמיים', 'רשימה אחת לכל הבית. מה שאחד מוסיף או מסמן, השני רואה מיד.'],
  ['chart', 'לא חורגים מהתקציב', 'ליד הרשימה רואים כמה נשאר לסופר החודש, וכמה אפשר להוציא בכל שבוע.'],
  ['check', 'פחות קניות דחף', 'קונים לפי רשימה, עם מה שקניתם בפעם הקודמת ומה שאתם קונים בדרך כלל.']
];
function Intro({ onClose }) {
  return html`<section class="card shop-intro" aria-labelledby="shop-intro-h">
    <div class="shop-intro-head"><span class="shop-intro-ic"><${Icon} name="spark" size=${20} /></span>
      <div><h2 id="shop-intro-h">קניות חכמות: עוזרים לכם לחסוך בסופר</h2><span class="muted">לא עוד רשימת קניות. כך זה עוזר לכם להוציא פחות:</span></div></div>
    <ul class="shop-benefits">${BENEFITS.map(([ic, t, d]) => html`<li key=${t}><span class="shop-b-ic"><${Icon} name=${ic} size=${18} /></span><span><b>${t}</b><span class="muted">${d}</span></span></li>`)}</ul>
    <button type="button" class="btn shop-intro-ok" onClick=${onClose}>הבנתי, בואו נתחיל</button>
  </section>`;
}

// "Shopping": one list for the whole household, live, sorted by department,
// remembered from one shopping to the next. Built for a computer first (type
// several items and press Enter; email, copy or print it; WhatsApp last), and works on a phone.
export function ShopScreen({ data, owner = false }) {
  const shop = useShopping(data.hid);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [area, setAreaText] = useState(null);
  const [listening, setListening] = useState(false);
  const input = useRef(null);
  const [intro, setIntro] = useState(() => !readLocal(INTRO_KEY, ''));
  const [prices, setPrices] = useState(false);
  const [advisor, setAdvisor] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const closeIntro = () => { writeLocal(INTRO_KEY, '1'); setIntro(false); };
  useEffect(() => { if (owner && data.hid) loadReceipts(data.hid).then(setReceipts).catch(() => setReceipts([])); }, [data.hid, owner]);
  useEffect(() => { if (data.hid) getArea(data.hid).then((a) => setAreaText(a)).catch(() => setAreaText('')); }, [data.hid]);

  if (shop.status === 'loading' || data.status !== 'ready') return html`<${Loading} label="טוען את הרשימה…" />`;
  if (shop.status === 'error') return html`<div class="card empty" role="alert"><b style="color:var(--text)">לא הצלחנו לטעון את הרשימה</b><button type="button" class="btn btn-ghost" onClick=${shop.reload}>לנסות שוב</button></div>`;

  const items = shop.items;
  const groups = grouped(items);
  const open = items.filter((i) => !i.cleared_at);
  const bought = open.filter((i) => i.done).length;
  const usualList = usual(items);
  const prev = previousList(items);
  const fb = foodBudget(data, new Date());
  // Who added an item matters only when more than one person shops.
  const many = Object.keys(data.members || {}).length > 1;

  const add = async (list, from = 'typed') => {
    const fresh = list.filter((i) => !onList(items, i.name));
    if (!fresh.length) { showToast(list.length === 1 ? list[0].name + ' כבר ברשימה' : 'הכול כבר ברשימה'); return; }
    setBusy(true);
    try {
      const rows = await addItems(data.hid, fresh);
      shop.patch((all) => [...all, ...rows.filter((r) => !all.some((a) => a.id === r.id))]);
      track(from === 'typed' ? 'shop_add' : 'shop_reuse');
    } catch (_e) { showToast('לא נוסף. נסו שוב.'); }
    setBusy(false);
  };
  const submit = async (e) => {
    e.preventDefault();
    const list = parseItems(text);
    if (!list.length || busy) return;
    await add(list);
    setText('');
    if (input.current) input.current.focus();
  };
  const toggle = async (i) => {
    shop.patch((all) => all.map((x) => (x.id === i.id ? { ...x, done: !i.done } : x)));
    try { await setDone(i.id, !i.done); } catch (_e) { shop.reload(); showToast('לא נשמר. נסו שוב.'); }
  };
  const remove = async (i) => {
    shop.patch((all) => all.filter((x) => x.id !== i.id));
    try { await removeItem(i.id); } catch (_e) { shop.reload(); showToast('לא נמחק. נסו שוב.'); }
  };
  const finish = async () => {
    try { await finishShopping(data.hid); track('shop_done'); await shop.reload(); showToast('נשמר. מה שקניתם יופיע ב"מה שאתם קונים בדרך כלל".'); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  const voice = () => {
    if (listening) return;
    setListening(true);
    listen({ onText: (t) => { setText((cur) => (cur ? cur + ', ' : '') + t); }, onEnd: () => setListening(false), onError: () => { setListening(false); showToast('לא שמענו. אפשר גם לכתוב.'); } });
  };
  const saveArea = async (e) => {
    e.preventDefault();
    try { await setArea(data.hid, area); showToast(area.trim() ? 'נשמר: קונים ב' + area.trim() : 'האזור נמחק'); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  const mailHref = 'mailto:?subject=' + encodeURIComponent('רשימת קניות') + '&body=' + encodeURIComponent(listText(items) + '\n\nמ"התקציב שלנו"');
  const waHref = 'https://wa.me/?text=' + encodeURIComponent('רשימת קניות\n\n' + listText(items));
  const copy = async () => { try { await navigator.clipboard.writeText(listText(items)); showToast('הרשימה הועתקה. אפשר להדביק בכל מקום.'); } catch (_e) { showToast('לא הצלחנו להעתיק.'); } };

  return html`<div class="shop">
    <section class="shop-main stack">
      <div class="shop-head">
        <span class="muted" style="font-size:14px">עוזרים לכם לחסוך בסופר: רשימה אחת לכל הבית, וכמה נשאר לסופר החודש. ${!intro && html`<button type="button" class="btn-text shop-what" onClick=${() => setIntro(true)}>מה זה?</button>`}</span>
        <span class="shop-tools">
          <a class="btn btn-ghost" href=${mailHref} aria-disabled=${String(!open.some((i) => !i.done))}><${Icon} name="mail" size=${17} />לשלוח במייל</a>
          <button type="button" class="btn btn-ghost" onClick=${copy} disabled=${!open.some((i) => !i.done)}>להעתיק</button>
          <button type="button" class="btn btn-ghost" onClick=${() => window.print()} disabled=${!open.some((i) => !i.done)}>להדפיס</button>
          <a class="btn btn-ghost" href=${waHref} target="_blank" rel="noopener" aria-disabled=${String(!open.some((i) => !i.done))}>וואטסאפ</a>
        </span>
      </div>
      <p class="shop-trial" role="note"><b>בהרצה:</b> הטאב חדש ועוד משתפר, וייתכנו תקלות. ראיתם משהו לא תקין? <button type="button" class="btn-text shop-trial-talk" onClick=${() => go('profile/feedback')}>כתבו לנו</button>.</p>
      ${intro && html`<${Intro} onClose=${closeIntro} />`}
      <form class="shop-add" onSubmit=${submit}>
        <input ref=${input} class="input" value=${text} onInput=${(e) => setText(e.target.value)} maxLength="300"
          aria-label="מה להוסיף לרשימה" placeholder="מה להוסיף? אפשר כמה ביחד: חלב, 2 ביצים, לחם" />
        ${canListen() && html`<button type="button" class=${'icon-btn shop-mic' + (listening ? ' on' : '')} aria-label="להוסיף בקול" onClick=${voice}><${Icon} name="mic" size=${19} /></button>`}
        <button type="submit" class="btn" disabled=${busy || !text.trim()}>להוסיף</button>
      </form>
      ${owner && html`<button type="button" class="card adv-cta" onClick=${() => { setAdvisor(true); track('shop_advisor_open'); }}><span class="adv-spark" aria-hidden="true"><${Icon} name="spark" size=${18} /></span><span><b>היועץ ממליץ: רשימה לשבוע</b><small class="muted">לפי מה שאתם קונים בדרך כלל ומספר הנפשות בבית. עורכים ומוסיפים בלחיצה.</small></span><span aria-hidden="true">‹</span></button>`}
      ${owner && advisor && html`<${AdvisorList} items=${items} people=${data.people} onClose=${() => setAdvisor(false)} onAdd=${(list) => add(list, 'advisor').then(() => track('shop_advisor_add'))} />`}
      ${owner && prices && html`<${PricePanel} hid=${data.hid} items=${items} receipts=${receipts} onClose=${() => setPrices(false)} onPicked=${(id, barcode) => shop.patch((all) => all.map((x) => (x.id === id ? { ...x, barcode } : x)))} />`}
      ${open.length === 0 && html`<div class="card empty shop-empty"><b style="color:var(--text)">הרשימה ריקה</b><span>כותבים למעלה מה צריך, או לוחצים על משהו מ"מה שאתם קונים בדרך כלל".</span></div>`}
      ${groups.map((g) => html`<div class="shop-group" key=${g.aisle}>
        <h2 class="shop-aisle"><${Icon} name=${AISLE_ICON[g.aisle] || 'cart'} size=${15} stroke=${1.8} />${g.label}<span class="shop-aisle-n">${g.items.filter((i) => !i.done).length || ''}</span></h2>
        <div class="card shop-items">
          ${g.items.map((i) => html`<div class=${'shop-item' + (i.done ? ' done' : '')} key=${i.id}>
            <label class="shop-check"><input type="checkbox" checked=${i.done} onChange=${() => toggle(i)} aria-label=${(i.done ? 'בוטל סימון: ' : 'נקנה: ') + i.name} /><span class="shop-name">${i.name}</span></label>
            ${i.qty && html`<span class="shop-qty">${i.qty}</span>`}
            ${many && data.members[i.added_by] && html`<span class="shop-who">${data.members[i.added_by].split(' ')[0]}</span>`}
            <button type="button" class="icon-btn shop-del" aria-label=${'להוריד את ' + i.name + ' מהרשימה'} onClick=${() => remove(i)}><${Icon} name="x" size=${15} /></button>
          </div>`)}
        </div>
      </div>`)}
      ${bought > 0 && html`<button type="button" class="btn shop-finish" onClick=${finish}>סיימתי לקנות (${bought} נקנו)</button>`}
      <div class="shop-print" aria-hidden="true">
        <h1>רשימת קניות</h1>
        <p>${new Date().toLocaleDateString('he-IL')}${fb ? ' · נשאר לסופר החודש: ' + money(Math.max(0, fb.left)) : ''}</p>
        ${groups.map((g) => { const left = g.items.filter((i) => !i.done); return left.length ? html`<div class="pg"><b>${g.label}</b>${left.map((i) => html`<div class="pl"><span class="pc"></span>${i.name}${i.qty ? ' (' + i.qty + ')' : ''}</div>`)}</div>` : null; })}
      </div>
    </section>
    <aside class="shop-side stack">
      ${!owner && html`<${PriceTeaser} />`}
      ${owner && !prices && open.some((i) => !i.done) && html`<div class="card stack shop-prices-cta">
        <b>כמה הרשימה תעלה?</b>
        <span class="muted" style="font-size:14px;line-height:1.5">לכל מוצר נבחר המוצר הזול ביותר בכשרות שבחרתם, ורואים כמה כל הרשימה עולה בכל רשת.</span>
        <button type="button" class="btn" onClick=${() => { setPrices(true); track('price_open'); }}><${Icon} name="cart" size=${17} />השוואת מחירים</button>
      </div>`}
      ${fb && html`<div class="card stack shop-budget">
        <div class="sec-row"><b>נשאר לסופר החודש</b><b class="num">${money(Math.max(0, fb.left))}</b></div>
        <span class="bar"><span style=${'width:' + Math.min(100, Math.round((fb.spent / fb.budget) * 100)) + '%;background:' + (fb.left < 0 ? 'var(--danger)' : 'var(--accent)')}></span></span>
        <span class="muted" style="font-size:13px">${fb.left < 0 ? 'עברתם את התקציב ל' + fb.name + ' ב-' + money(-fb.left) : 'מתוך ' + money(fb.budget) + ' ל' + fb.name + ' · הוצאתם ' + money(fb.spent)}</span>
        ${fb.left > 0 && html`<span class="shop-week">כדי לעמוד בתקציב: עד <b class="num">${money(perWeek(fb.left))}</b> לשבוע עד סוף החודש</span>`}
      </div>`}
      ${owner && html`<${Receipts} hid=${data.hid} receipts=${receipts}
        onSaved=${(out) => { if (out.saved) setReceipts((r) => [out.saved, ...r]); if (out.history.length) shop.patch((all) => [...all, ...out.history.filter((h) => !all.some((a) => a.id === h.id))]); }}
        onAddToList=${(list) => add(list, 'receipt')} />`}
      ${prev.length > 0 && html`<div class="card stack" style="gap:8px">
        <b>הרשימה מהפעם הקודמת</b>
        <span class="muted" style="font-size:14px;line-height:1.5">${prev.slice(0, 6).map((i) => i.name).join(', ')}${prev.length > 6 ? ' ועוד ' + (prev.length - 6) : ''}</span>
        <button type="button" class="btn btn-ghost" onClick=${() => add(prev.map((i) => ({ name: i.name, qty: i.qty, aisle: i.aisle || aisleOf(i.name) })), 'reuse')}>להחזיר את כל ${prev.length} לרשימה</button>
      </div>`}
      ${usualList.length > 0 && html`<div class="card stack" style="gap:8px">
        <b>מה שאתם קונים בדרך כלל</b>
        <div class="chips">${usualList.map((n) => html`<button type="button" class="chip" onClick=${() => add([{ name: n, qty: null, aisle: aisleOf(n) }], 'reuse')}>+ ${n}</button>`)}</div>
      </div>`}
      ${!owner && html`<form class="card stack shop-area" style="gap:8px" onSubmit=${saveArea}>
        <b>איפה אתם קונים?</b>
        <span class="muted" style="font-size:14px;line-height:1.5">עיר או שכונה. בהמשך נשתמש בזה כדי להראות מחירים מהסניפים הקרובים אליכם.</span>
        <span style="display:flex;gap:8px"><input class="input" value=${area || ''} onInput=${(e) => setAreaText(e.target.value)} maxLength="60" aria-label="עיר או שכונה" placeholder="למשל: בית שמש, רמת ג׳" style="flex:1;min-width:0" />
        <button type="submit" class="btn btn-ghost" style="width:auto">לשמור</button></span>
      </form>`}
    </aside>
  </div>`;
}
