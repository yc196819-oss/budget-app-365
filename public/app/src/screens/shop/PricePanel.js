import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { CERTS, NOT_KOSHER, chooseAll, basket, bestPrice, certOf, certFromText, nonFood, size, sizeText, count } from '../../domain/prices.js';
import { searchPrices, fetchPrices, fetchStatus, getKosherPref, setKosherPref, voteKosher, pickProduct, productImages } from '../../data/prices.js';
import { aisleOf } from '../../domain/shopping.js';
import { showToast } from '../../lib/toast.js';
import { track } from '../../lib/telemetry.js';

// "What will it cost": every item on the list gets one exact product (by
// barcode), picked automatically as the cheapest at the household's kashrut
// level, and the whole list is priced at each chain. Items with nothing in
// our catalog are looked up once, in the background.

const fmt = (n) => '₪' + (Math.round(n * 100) / 100).toFixed(2);

// Which kashrut the product has, and whether it is one this family relies on.
const CERT_NAMES = [...CERTS.map((c) => c.name), NOT_KOSHER];
let MINE = [];
function Kosher({ p }) {
  if (nonFood(p)) return html`<span class="kosher kosher-free">לא צריך כשרות</span>`;
  const c = certOf(p);
  if (c) {
    const who = c.by === 'owner' ? 'אושר על ידינו' : c.by === 'open' ? 'מהמאגר הפתוח' : 'סימנו ' + c.n + (c.n === 1 ? ' משפחה' : ' משפחות');
    if (c.cert === NOT_KOSHER) return html`<span class="kosher kosher-none">לא כשר · ${who}</span>`;
    const fits = MINE.includes(c.cert);
    return html`<span class=${'kosher ' + (fits ? 'kosher-fits' : 'kosher-other')}>${fits ? '✓ ' : ''}${c.cert}${fits ? ' · מתאים לכם' : ' · לא ברשימה שלכם'} <small>(${who})</small></span>`;
  }
  const hint = certFromText(p.name);
  return html`<span class="kosher kosher-unknown">כשרות לא ידועה${hint ? ' (בשם כתוב: ' + hint + ')' : ''}</span>`;
}
// "What does the package say?": one tap, and it helps every family.
function Mark({ p, onVote, label = 'מה כתוב על האריזה?' }) {
  const mine = p.kosher && p.kosher.mine_cert;
  return html`<span class="price-vote"><small class="muted">${mine ? 'סימנתם: ' + mine + '. לשנות:' : label}</small>${CERT_NAMES.map((c) => html`<button type="button" class=${'chip' + (c === NOT_KOSHER ? ' chip-no' : '')} key=${c} aria-pressed=${mine === c} onClick=${() => onVote(p, c)}>${c}</button>`)}</span>`;
}
// The certifiers the family relies on: several can be picked.
function CertPicker({ initial, onSave, onAny, onCancel }) {
  const [sel, setSel] = useState(() => new Set(Array.isArray(initial) ? initial : []));
  const flip = (c) => setSel((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  return html`<div class="stack price-certs">
    <b>על איזו כשרות אתם סומכים?</b>
    <span class="muted" style="line-height:1.55">אפשר לסמן כמה. לכל מוצר ברשימה ייבחר לבד הזול ביותר באחת מהן. מוצר שהכשרות שלו לא ידועה לא ייבחר לבד: תראו אותו, ותוכלו לסמן מה כתוב על האריזה.</span>
    <div class="price-cert-chips" role="group" aria-label="כשרויות">${CERTS.map((c) => html`<button type="button" class="chip" key=${c.name} aria-pressed=${sel.has(c.name)} onClick=${() => flip(c.name)}>${c.name}</button>`)}</div>
    <div class="price-cert-actions"><button type="button" class="btn btn-primary" style="width:auto" disabled=${!sel.size} onClick=${() => onSave(CERTS.map((c) => c.name).filter((c) => sel.has(c)))}>לשמור${sel.size ? ' (' + sel.size + ')' : ''}</button>
      <button type="button" class="btn-text" onClick=${onAny}>בלי העדפה: הכי זול</button>
      ${onCancel && html`<button type="button" class="btn-text" onClick=${onCancel}>ביטול</button>`}</div>
  </div>`;
}

// The product's photo (from the open product database), or the sign of its
// department when it has none.
const SIGN = { produce: '🥬', bakery: '🍞', dairy: '🥛', meat: '🍗', dry: '🥫', frozen: '🧊', drinks: '🥤', clean: '🧽', care: '🧴', baby: '🍼', other: '🛒' };
let IMAGES = {};
function Photo({ p }) {
  const url = IMAGES[p.barcode];
  return url ? html`<span class="price-img"><img src=${url} alt="" loading="lazy" /></span>` : html`<span class="price-img sign" aria-hidden="true">${SIGN[aisleOf(p.name)] || SIGN.other}</span>`;
}

function Product({ p, children }) {
  const b = bestPrice(p);
  const sz = sizeText(size(p.qty, p.unit));
  return html`<div class="price-prod"><${Photo} p=${p} />
    <span class="price-prod-t"><b>${p.name}</b><small class="muted">${[p.maker, sz].filter(Boolean).join(' · ')}</small><${Kosher} p=${p} /></span>
    ${b && html`<span class="price-prod-p"><b class="num">${fmt(b.price)}</b><small class="muted">${b.chainName}</small></span>`}
    ${children}
  </div>`;
}

export function PricePanel({ hid, items, onClose, onPicked }) {
  const open = items.filter((i) => !i.cleared_at && !i.done);
  const [pref, setPref] = useState(undefined);
  const [catalog, setCatalog] = useState(null);
  const [err, setErr] = useState('');
  const [looking, setLooking] = useState(0);
  // Items not in the catalog yet, written down for the next load (families
  // never wait for the price service).
  const [queued, setQueued] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [voteId, setVoteId] = useState(null);
  const [editPref, setEditPref] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { getKosherPref(hid).then((k) => setPref(k)).catch(() => setPref(null)); }, [hid]);

  const names = open.map((i) => i.name);
  const search = async () => {
    try { const c = await searchPrices(names); if (alive.current) { setCatalog(c); setErr(''); } return c; } catch (_e) { if (alive.current) setErr('לא הצלחנו לטעון מחירים. נסו שוב.'); return null; }
  };
  // Items with nothing in our catalog: asked of the price service once, then
  // checked on every few seconds (up to 4 minutes), then searched again.
  const lookUp = async (c) => {
    const missing = names.filter((n) => !(c[n] || []).length);
    if (!missing.length) return;
    try {
      const r = await fetchPrices(hid, missing);
      if (r.queued) setQueued(true);
      if (!r.runId) return;
      setLooking(r.asked);
      for (let i = 0; i < 48 && alive.current; i++) {
        await new Promise((ok) => setTimeout(ok, 5000));
        const st = await fetchStatus(r.runId).catch(() => null);
        if (st && st.done) break;
      }
      if (alive.current) { setLooking(0); await search(); }
    } catch (e) { if (alive.current) { setLooking(0); showToast(e.message || 'לא הצלחנו לחפש מחירים חדשים.'); } }
  };
  // Photos for what is on screen, once the catalog answered.
  const [, setShown] = useState(0);
  useEffect(() => {
    if (!catalog) return;
    const codes = [...new Set(Object.values(catalog).flatMap((list) => (list || []).slice(0, 6).map((p) => p.barcode)))].filter((c) => !(c in IMAGES)).slice(0, 60);
    if (!codes.length) return;
    productImages(codes).then((r) => { IMAGES = { ...IMAGES, ...Object.fromEntries(codes.map((c) => [c, ''])), ...(r.images || {}) }; if (alive.current) setShown((n) => n + 1); }).catch(() => {});
  }, [catalog]);
  const key = names.join('|');
  useEffect(() => { if (!pref) return; search().then((c) => c && lookUp(c)); }, [pref, key]);

  const choosePref = async (k) => {
    setPref(k);
    setEditPref(false);
    try { await setKosherPref(hid, k); } catch (_e) { showToast('ההעדפה לא נשמרה. נסו שוב.'); }
  };
  const pick = async (item, p) => {
    onPicked(item.id, p.barcode);
    setOpenId(null);
    track('price_pick');
    try { await pickProduct(item.id, p.barcode); } catch (_e) { showToast('הבחירה לא נשמרה. נסו שוב.'); }
  };
  const vote = async (p, cert) => {
    setVoteId(null);
    try {
      await voteKosher(hid, p.barcode, cert);
      const k = p.kosher || {};
      const certs = { ...(k.certs || {}) };
      if (k.mine_cert) certs[k.mine_cert] = Math.max(0, (certs[k.mine_cert] || 1) - 1);
      certs[cert] = (certs[cert] || 0) + 1;
      setCatalog((c) => Object.fromEntries(Object.entries(c).map(([n, list]) => [n, list.map((x) => (x.barcode === p.barcode ? { ...x, kosher: { ...k, certs, mine_cert: cert } } : x))])));
      showToast('תודה! נרשם: ' + cert + '. זה עוזר לכל המשפחות.');
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  MINE = Array.isArray(pref) ? pref : [];

  const head = html`<div class="price-head"><b class="price-title"><${Icon} name="cart" size=${18} />כמה הרשימה תעלה</b>
    <button type="button" class="icon-btn" aria-label="לסגור את השוואת המחירים" onClick=${onClose}><${Icon} name="x" size=${16} /></button></div>`;
  const prefRow = editPref ? html`<${CertPicker} initial=${pref} onSave=${choosePref} onAny=${() => choosePref('any')} onCancel=${() => setEditPref(false)} />`
    : html`<div class="price-pref"><span class="muted">כשרות:</span><b class="price-pref-certs">${Array.isArray(pref) ? pref.join(' · ') : 'בלי העדפה'}</b>
      <button type="button" class="btn-text" onClick=${() => setEditPref(true)}>לשנות</button></div>`;

  if (pref === undefined) return html`<section class="card stack price-panel">${head}<span class="muted">רגע…</span></section>`;
  if (!pref) return html`<section class="card stack price-panel">${head}<${CertPicker} onSave=${choosePref} onAny=${() => choosePref('any')} /></section>`;
  if (!open.length) return html`<section class="card stack price-panel">${head}${prefRow}<span class="muted">אין מה להשוות: הרשימה ריקה או שהכול כבר נקנה.</span></section>`;
  if (!catalog) return html`<section class="card stack price-panel" aria-busy="true">${head}${prefRow}${err ? html`<span role="alert">${err} <button type="button" class="btn-text" onClick=${search}>לנסות שוב</button></span>` : html`<span class="muted">מחפשים מחירים ל-${open.length} מוצרים…</span>`}</section>`;

  const choices = chooseAll(open.map((i) => ({ id: i.id, name: i.name, barcode: i.barcode })), catalog, pref);
  const qtyOf = (c) => count((open.find((i) => i.id === c.id) || {}).qty);
  const chains = basket(choices, qtyOf);
  const priced = choices.filter((c) => c.pick).length;
  const unsure = choices.filter((c) => c.status === 'unsure').length;
  const best = chains[0];
  return html`<section class="card stack price-panel">
    ${head}${prefRow}
    ${best && html`<div class="price-chains" aria-label="הרשימה בכל רשת">
      ${chains.slice(0, 4).map((c, i) => html`<div class=${'price-chain' + (i === 0 ? ' best' : '')} key=${c.chain}>
        <small>${i === 0 ? 'הכי זול' : c.name}</small><b class="num">${fmt(c.total)}</b>${i === 0 && html`<small>${c.name}</small>`}
        ${c.missing > 0 && html`<small class="faint">חסרים ${c.missing}</small>`}</div>`)}
    </div>`}
    <span class="muted price-count">נמצא מחיר ל-${priced} מתוך ${open.length} מוצרים${unsure ? ' · ' + unsure + ' מחכים לבחירה שלכם' : ''}${looking ? ' · מחפשים עכשיו עוד ' + looking + '…' : ''}</span>
    <ul class="price-list">
      ${choices.map((c) => { const item = open.find((i) => i.id === c.id); const expanded = openId === c.id; return html`<li key=${c.id} class=${'price-item is-' + c.status}>
        <div class="price-item-head"><b>${item.name}</b>${item.qty && html`<span class="shop-qty">${item.qty}</span>`}
          <span class="price-state">${c.status === 'auto' ? 'נבחר אוטומטית' : c.status === 'chosen' ? 'בחרתם' : c.status === 'unsure' ? 'בחרו מוצר' : looking ? 'מחפשים…' : queued ? 'עוד לא בקטלוג: נוסיף בקרוב' : 'לא נמצא מחיר'}</span></div>
        ${c.pick && html`<${Product} p=${c.pick} />`}
        ${c.status === 'unsure' && html`<span class="price-warn">מצאנו מוצרים, אבל לא ידוע שהכשרות שלהם היא מהרשימה שלכם. בחרו מוצר, או סמנו מה כתוב על האריזה:</span>`}
        ${c.options.length > 0 && (c.status === 'unsure' || expanded) && html`<ul class="price-opts">${c.options.map((p) => html`<li key=${p.barcode}><${Product} p=${p}>
          <button type="button" class="btn btn-ghost price-pick" onClick=${() => pick(item, p)}>לבחור</button></${Product}>
          ${!certOf(p) && !nonFood(p) && html`<${Mark} p=${p} onVote=${vote} />`}</li>`)}</ul>`}
        ${c.pick && html`<span class="price-actions">
          ${c.options.length > 1 && html`<button type="button" class="btn-text" aria-expanded=${expanded} onClick=${() => setOpenId(expanded ? null : c.id)}>${expanded ? 'לסגור' : 'להחליף מוצר (' + (c.options.length - 1) + ')'}</button>`}
          ${!nonFood(c.pick) && (voteId === c.id ? html`<${Mark} p=${c.pick} onVote=${vote} />`
            : html`<button type="button" class="btn-text price-vote-open" onClick=${() => setVoteId(c.id)}>${c.pick.kosher && c.pick.kosher.mine_cert ? 'סימנתם: ' + c.pick.kosher.mine_cert + ' · לשנות' : certOf(c.pick) ? 'הכשרות לא נכונה?' : 'לסמן כשרות'}</button>`)}
        </span>`}
      </li>`; })}
    </ul>
    <p class="faint price-note">המחירים מהקבצים הרשמיים שהרשתות מפרסמות, מסניף אחד בכל רשת. בסניף שלכם המחיר יכול להיות מעט שונה. הכשרות לפי מה שמשפחות סימנו, המאגר הפתוח ואישור שלנו, ולכן תמיד כדאי לבדוק את החותמת על המוצר.</p>
  </section>`;
}

// For everyone but the owner, while the catalog grows: a live preview of
// what is coming, with sample products (not real prices), and a way to say
// "tell me when it opens" (kept on this device, counted for the owner).
const DEMO = [
  { item: 'חלב 3%', pick: 'חלב 3% בשקית, 1 ליטר', kosher: 'כשר למהדרין', prices: [6.2, 6.9, 6.5] },
  { item: 'ביצים L', pick: 'תבנית 12 ביצים', kosher: 'כשר למהדרין', prices: [13.9, 15.9, 14.5] },
  { item: 'קפה טורקי', pick: 'קפה טורקי, 200 גרם', kosher: 'כשר', prices: [14.9, 16.9, 15.5] }
];
const DEMO_CHAINS = ['רשת א', 'רשת ב', 'רשת ג'];
export function PriceTeaser() {
  const [asked, setAsked] = useState(() => { try { return localStorage.getItem('price:notify') === '1'; } catch (_e) { return false; } });
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setAt((x) => (x + 1) % DEMO.length), 2600);
    return () => clearInterval(t);
  }, []);
  const totals = DEMO_CHAINS.map((_, c) => DEMO.reduce((s, d) => s + d.prices[c], 0));
  const best = totals.indexOf(Math.min(...totals));
  const d = DEMO[at];
  const ask = () => { try { localStorage.setItem('price:notify', '1'); } catch (_e) { /* ignore */ } setAsked(true); track('price_notify'); };
  return html`<section class="card stack price-teaser" aria-labelledby="price-teaser-h">
    <div class="price-teaser-head"><b id="price-teaser-h">השוואת מחירים</b><span class="nav-tag">בקרוב</span></div>
    <span class="muted" style="font-size:14px;line-height:1.55">כותבים את הרשימה, ולכל מוצר נבחר לבד הזול ביותר בכשרות שלכם. רואים כמה כל הרשימה עולה בכל רשת, ואיפה הכי משתלם לקנות.</span>
    <div class="price-demo" aria-hidden="true">
      <div class="price-demo-item" key=${at}><small class="muted">${d.item}</small><b>${d.pick}</b><span class="kosher kosher-mehadrin">${d.kosher}</span>
        <span class="price-demo-row">${DEMO_CHAINS.map((c, i) => html`<span class=${'price-demo-p' + (d.prices[i] === Math.min(...d.prices) ? ' best' : '')} key=${c}><small>${c}</small>₪${d.prices[i].toFixed(2)}</span>`)}</span></div>
      <div class="price-demo-total"><small>הרשימה כולה, הכי זול ב${DEMO_CHAINS[best]}</small><b>₪${totals[best].toFixed(2)}</b></div>
    </div>
    <small class="faint">דוגמה בלבד, לא מחירים אמיתיים.</small>
    ${asked ? html`<span class="price-teaser-ok" role="status">נרשמתם. נודיע לכם כשזה נפתח.</span>`
      : html`<button type="button" class="btn btn-ghost" onClick=${ask}>תודיעו לי כשזה נפתח</button>`}
  </section>`;
}
