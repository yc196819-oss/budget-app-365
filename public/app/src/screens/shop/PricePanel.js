import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { CERTS, NOT_KOSHER, chooseAll, basket, saving, chainNote, bestAlways, bestPrice, certOf, certFromText, nonFood, nearby, size, sizeOfProduct, sizeText, count, twoChains, chainListText, baseChain, isOnlineChain, SHABBAT_CHAINS, hiddenChains, withoutChains, haredi } from '../../domain/prices.js';
import { lastPaid } from '../../domain/receipts.js';
import { PROMO_POLICY, promoText, offText } from '../../domain/promos.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { searchPrices, fetchPrices, fetchStatus, getKosherPref, setKosherPref, voteKosher, pickProduct, productImages, getArea, setArea, findPlaces, getClubs, setClubs, getChainsShown, setChainsShown } from '../../data/prices.js';
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
    return html`<span class=${'kosher ' + (fits ? 'kosher-fits' : 'kosher-other')}>${c.cert}${fits ? ' · מתאים לכם' : ' · לא ברשימה שלכם'} <small>(${who})</small></span>`;
  }
  const hint = certFromText(p.name);
  return html`<span class="kosher kosher-unknown">כשרות לא אומתה${hint ? ' · בשם כתוב: ' + hint : ' · לבדוק על האריזה'}</span>`;
}
// "What does the package say?": one tap, and it helps every family.
// Closed until tapped: a list of products does not show twelve buttons under
// each one.
function Mark({ p, onVote, label = 'מה כתוב על האריזה?', open: startOpen = false }) {
  const mine = p.kosher && p.kosher.mine_cert;
  const [open, setOpen] = useState(startOpen);
  if (!open) return html`<button type="button" class="btn-text price-vote-open" aria-expanded="false" onClick=${() => setOpen(true)}>${mine ? 'סימנתם: ' + mine + ' · לשנות' : label + ' לסמן'}</button>`;
  return html`<span class="price-vote"><small class="muted">${mine ? 'סימנתם: ' + mine + '. לשנות:' : label}</small>${CERT_NAMES.map((c) => html`<button type="button" class=${'chip' + (c === NOT_KOSHER ? ' chip-no' : '')} key=${c} aria-pressed=${mine === c} onClick=${() => { setOpen(false); onVote(p, c); }}>${c}</button>`)}</span>`;
}
const CHAIN_LABEL = { 'tiv-taam': 'טיב טעם' };
// The clubs the family has: for each chain in the comparison, its customers
// club and its credit card. Their deals then count in that chain's total.
function ClubPicker({ chains, initial, onSave, onCancel }) {
  const [sel, setSel] = useState(() => new Set(initial));
  const [all, setAll] = useState(false);
  const flip = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // The cheapest chains for this list first (and any already marked); the rest on request.
  // (A club is the chain's, online too: each chain once, as its shop.)
  const own = chains.filter((c) => !isOnlineChain(c.chain) || !chains.some((x) => x.chain === baseChain(c.chain))).map((c) => (isOnlineChain(c.chain) ? { ...c, chain: baseChain(c.chain), name: c.name.replace(/ אונליין$/, '') } : c));
  const list = all ? own : own.filter((c, i) => i < 6 || sel.has(c.chain + ':club') || sel.has(c.chain + ':card'));
  return html`<div class="stack price-certs pp-clubs">
    <b>באילו רשתות אתם במועדון?</b>
    <span class="muted" style="line-height:1.55">מבצעים של מועדון או של כרטיס האשראי של הרשת ייכנסו לסכום רק ברשתות שתסמנו.</span>
    <ul class="pp-club-list">${list.map((c) => html`<li key=${c.chain}><span>${c.name}</span>
      <button type="button" class="chip" aria-pressed=${sel.has(c.chain + ':club')} onClick=${() => flip(c.chain + ':club')}>מועדון</button>
      <button type="button" class="chip" aria-pressed=${sel.has(c.chain + ':card')} onClick=${() => flip(c.chain + ':card')}>כרטיס אשראי</button></li>`)}</ul>
    ${!all && list.length < own.length && html`<button type="button" class="btn-text" style="justify-self:start" onClick=${() => setAll(true)}>כל הרשתות (${own.length})</button>`}
    <div class="price-cert-actions"><button type="button" class="btn btn-primary" style="width:auto" onClick=${() => onSave(sel)}>לשמור</button>
      <button type="button" class="btn-text" onClick=${onCancel}>ביטול</button></div>
  </div>`;
}
// The certifiers the family relies on: several can be picked.
function CertPicker({ initial, onSave, onAny, onCancel, step }) {
  const [sel, setSel] = useState(() => new Set(Array.isArray(initial) ? initial : []));
  const flip = (c) => setSel((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  return html`<div class="stack price-certs">
    ${step && html`<small class="pp-step">${step}</small>`}<b>על איזו כשרות אתם סומכים?</b>
    <span class="muted" style="line-height:1.55">אפשר לסמן כמה. לכל מוצר ברשימה ייבחר לבד הזול ביותר באחת מהן. מוצר שהכשרות שלו לא ידועה לא ייבחר לבד: תראו אותו, ותוכלו לסמן מה כתוב על האריזה.</span>
    <div class="price-cert-chips" role="group" aria-label="כשרויות">${CERTS.map((c) => html`<button type="button" class="chip" key=${c.name} aria-pressed=${sel.has(c.name)} onClick=${() => flip(c.name)}>${c.name}</button>`)}</div>
    <div class="price-cert-actions"><button type="button" class="btn btn-primary" style="width:auto" disabled=${!sel.size} onClick=${() => onSave(CERTS.map((c) => c.name).filter((c) => sel.has(c)))}>לשמור${sel.size ? ' (' + sel.size + ')' : ''}</button>
      <button type="button" class="btn-text" onClick=${onAny}>בלי העדפה: הכי זול</button>
      ${onCancel && html`<button type="button" class="btn-text" onClick=${onCancel}>ביטול</button>`}</div>
  </div>`;
}

// The product's photo (from the open product database), or the line icon of
// its department when it has none.
const SIGN = { produce: 'leaf', bakery: 'bread', dairy: 'milk', meat: 'fish', dry: 'jar', frozen: 'snow', drinks: 'cup', clean: 'drop', care: 'drop', baby: 'baby', other: 'cart' };
let IMAGES = {};
function Photo({ p, name }) {
  const url = p && IMAGES[p.barcode];
  return url ? html`<span class="price-img"><img src=${url} alt="" loading="lazy" /></span>` : html`<span class="price-img sign" aria-hidden="true"><${Icon} name=${SIGN[aisleOf((p && p.name) || name)] || 'cart'} size=${18} stroke=${1.7} /></span>`;
}

function Product({ p, children }) {
  const b = bestPrice(p);
  const sz = sizeText(sizeOfProduct(p));
  return html`<div class="price-prod"><${Photo} p=${p} />
    <span class="price-prod-t"><b>${p.name}</b><small class="muted">${[p.maker, sz].filter(Boolean).join(' · ')}</small><${Kosher} p=${p} /></span>
    ${b && html`<span class="price-prod-p"><b class="num">${fmt(b.price)}</b><small class="muted">${b.chainName}</small></span>`}
    ${children}
  </div>`;
}

// Where the family lives: a settlement (chosen from the list as they type)
// and a neighborhood if they want. No chain, no branch: we find the branch
// near them at every chain.
function AreaPicker({ hid, initial, onDone, onSkip, onCancel, step }) {
  const [q, setQ] = useState(initial ? initial.city : '');
  const [place, setPlace] = useState(initial ? { code: initial.city_code, name: initial.city } : null);
  const [hood, setHood] = useState((initial && initial.hood) || '');
  const [maxKm, setMaxKm] = useState((initial && initial.max_km) || 25);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (place && place.name === q) { setList([]); return undefined; }
    if (q.trim().length < 2) { setList([]); return undefined; }
    const t = setTimeout(() => findPlaces(q.trim()).then((r) => setList(r.places || [])).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  const save = async () => {
    if (!place) return;
    setBusy(true); setErr('');
    try { const r = await setArea(hid, place.code, hood.trim(), maxKm); onDone({ ...r.area, stores: r.stores || [] }); } catch (e) { setErr(e.message || 'לא נשמר. נסו שוב.'); }
    setBusy(false);
  };
  return html`<div class="stack price-area-pick">
    ${step && html`<small class="pp-step">${step}</small>`}<b>איפה אתם גרים?</b>
    <span class="muted" style="line-height:1.55">רק יישוב, ושכונה אם רוצים. לא צריך לבחור רשת או סניף: נמצא לבד את הסניף הקרוב אליכם בכל רשת, ונשווה במחירים שלו.</span>
    <label class="price-area-field"><span>יישוב</span><input class="input" value=${q} placeholder="למשל: בית שמש" autocomplete="off" aria-label="יישוב" onInput=${(e) => { setQ(e.currentTarget.value); setPlace(null); }} /></label>
    ${list.length > 0 && html`<ul class="price-area-list" role="listbox" aria-label="יישובים">${list.map((p) => html`<li key=${p.code}><button type="button" role="option" onClick=${() => { setPlace(p); setQ(p.name); setList([]); }}>${p.name}</button></li>`)}</ul>`}
    ${place && html`<label class="price-area-field"><span>שכונה <small class="muted">(לא חובה, עוזר לדייק)</small></span><input class="input" value=${hood} maxLength="60" placeholder="למשל: רמת בית שמש א׳" aria-label="שכונה" onInput=${(e) => setHood(e.currentTarget.value)} /></label>`}
    ${place && html`<label class="price-area-field"><span>עד כמה רחוק אתם מוכנים לנסוע לקנות? <b class="num">${maxKm} ק"מ</b></span>
      <input type="range" class="price-km" min="5" max="50" step="5" value=${maxKm} aria-label="מרחק מהבית בקילומטרים" aria-valuetext=${maxKm + ' קילומטר'} onInput=${(e) => setMaxKm(Number(e.currentTarget.value))} />
      <span class="price-km-scale" aria-hidden="true"><small>5</small><small>25</small><small>50 ק"מ</small></span></label>`}
    ${err && html`<span role="alert" class="price-warn">${err}</span>`}
    <div class="price-cert-actions"><button type="button" class="btn btn-primary" style="width:auto" disabled=${!place || busy} onClick=${save}>${busy ? 'מחפשים סניפים…' : 'למצוא סניפים קרובים'}</button>
      ${onSkip && html`<button type="button" class="btn-text" onClick=${onSkip}>לא עכשיו</button>`}
      ${onCancel && html`<button type="button" class="btn-text" onClick=${onCancel}>ביטול</button>`}</div>
    <small class="faint">לא שואלים כתובת מדויקת ולא משתמשים במיקום של הטלפון.</small>
  </div>`;
}

export function PricePanel({ hid, items, receipts = [], onClose, onPicked }) {
  const open = items.filter((i) => !i.cleared_at && !i.done);
  // While the prices are open, the advisor's floating button would sit on
  // the prices column: it steps aside.
  useEffect(() => { document.body.classList.add('pp-on'); return () => document.body.classList.remove('pp-on'); }, []);
  // Opened: its start in view (the first question, or the total), not the
  // list the person tapped from.
  const toStart = () => {
    const el = document.querySelector('.price-panel');
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };
  useEffect(toStart, []);
  const [pref, setPref] = useState(undefined);
  const [catalog, setCatalog] = useState(null);
  // And again when the prices arrive: before them the page may have been too
  // short to scroll (a wide screen).
  const arrived = useRef(false);
  useEffect(() => { if (catalog && !arrived.current) { arrived.current = true; toStart(); } }, [catalog]);
  const [err, setErr] = useState('');
  const [looking, setLooking] = useState(0);
  // Items not in the catalog yet, written down for the next load (families
  // never wait for the price service).
  const [queued, setQueued] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [voteId, setVoteId] = useState(null);
  const [editPref, setEditPref] = useState(false);
  const [chainSel, setChainSel] = useState(null);
  // The chains whose club or credit card the family has ('rami-levy:club').
  const [clubs, setClubsState] = useState(() => new Set());
  const [editClubs, setEditClubs] = useState(false);
  // Chains open on Shabbat brought back by a family with a Haredi kashrut.
  const [shownChains, setShownChains] = useState([]);
  // The comparison worked out again only when what it depends on changed
  // (not when a row opens or a chain is tapped): a long list on a slow phone.
  const memo = useRef({ key: null });
  // The comparison's settings, folded into one line (open while one is edited).
  const [setOpen, setSetOpen] = useState(false);
  const [strict, setStrict] = useState(() => readLocal('price:strict:' + hid, '') === '1');
  const setStrictPref = (v) => { setStrict(v); writeLocal('price:strict:' + hid, v ? '1' : ''); };
  // The family's area: undefined while loading, null when not chosen.
  const [area, setAreaState] = useState(undefined);
  const [editArea, setEditArea] = useState(false);
  const [skipArea, setSkipArea] = useState(false);
  useEffect(() => { getArea(hid).then((a) => setAreaState(a)).catch(() => setAreaState(null)); }, [hid]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { getKosherPref(hid).then((k) => setPref(k)).catch(() => setPref(null)); }, [hid]);
  useEffect(() => { getClubs(hid).then((c) => setClubsState(new Set(c))).catch(() => {}); }, [hid]);
  useEffect(() => { getChainsShown(hid).then(setShownChains).catch(() => {}); }, [hid]);
  const flipChain = async (key) => {
    const before = shownChains;
    const next = before.includes(key) ? before.filter((k) => k !== key) : [...before, key];
    setShownChains(next);
    try { await setChainsShown(hid, next); } catch (_e) { setShownChains(before); showToast('לא נשמר. נסו שוב.'); }
  };
  const saveClubs = async (next, toast) => {
    const before = clubs;
    setClubsState(next);
    try { await setClubs(hid, [...next]); track('price_clubs'); if (toast) showToast(toast); } catch (_e) { setClubsState(before); showToast('לא נשמר. נסו שוב.'); }
  };

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
  const areaKey = area ? area.city_code + ':' + (area.hood || '') : '';
  // Once both the kashrut and the area are known (each loads on its own):
  // searching on the first and again on the second asked the database twice.
  useEffect(() => { if (!pref || area === undefined) return; search().then((c) => c && lookUp(c)); }, [pref, key, areaKey, area === undefined]);

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
      <button type="button" class="btn-text pp-area-edit" onClick=${() => setEditPref(true)}>לשנות</button></div>`;

  // For a Haredi kashrut: the chains open on Shabbat, left out; a tap brings one back.
  const shabbatRow = haredi(pref) && html`<div class="price-pref pp-shabbat-row"><span class="muted">פתוחה בשבת, לא בהשוואה:</span>
    <span class="pp-shabbat-chips">${Object.keys(SHABBAT_CHAINS).map((k) => html`<button type="button" class="chip" key=${k} aria-pressed=${shownChains.includes(k)} title=${SHABBAT_CHAINS[k]} onClick=${() => flipChain(k)}>${CHAIN_LABEL[k]}${shownChains.includes(k) ? ' · מוצגת' : ''}</button>`)}</span>
    <small class="muted pp-area-note">לחיצה מחזירה אותה להשוואה.</small></div>`;
  const areaDone = (a) => { setAreaState(a); setEditArea(false); track('price_area'); showToast(a.stores.length ? 'מצאנו סניף קרוב ב-' + a.stores.length + ' רשתות' : 'לא מצאנו סניפים קרובים. נשווה במחירים הכלליים.'); };
  const areaRow = editArea ? html`<${AreaPicker} hid=${hid} initial=${area} onDone=${areaDone} onCancel=${() => setEditArea(false)} />`
    : area ? html`<div class="price-pref price-area"><span class="muted pp-pin"><${Icon} name="pin" size=${15} /></span><b>${[area.hood, area.city].filter(Boolean).join(', ')}</b><button type="button" class="btn-text pp-area-edit" onClick=${() => setEditArea(true)}>לשנות</button><small class="muted pp-area-note">${!area.stores.length ? 'אין סניף של אף רשת עד ' + (area.max_km || 25) + ' ק"מ' : area.stores.length === 1 ? 'סניף אחד עד ' + (area.max_km || 25) + ' ק"מ' : area.stores.length + ' סניפים עד ' + (area.max_km || 25) + ' ק"מ'}</small></div>`
      : html`<div class="price-pref price-area"><span class="muted">מחירים כלליים, לא לפי האזור שלכם.</span><button type="button" class="btn-text pp-area-edit" onClick=${() => setEditArea(true)}>לבחור אזור</button></div>`;

  if (pref === undefined || area === undefined) return html`<section class="card stack price-panel">${head}<span class="muted">רגע…</span></section>`;
  // A first visit: two short questions, said as such, then the result.
  if (!pref) return html`<section class="card stack price-panel">${head}<${CertPicker} step=${!area ? 'שאלה 1 מתוך 2' : null} onSave=${choosePref} onAny=${() => choosePref('any')} /></section>`;
  if (!area && !skipArea) return html`<section class="card stack price-panel">${head}<${AreaPicker} step="שאלה אחרונה" hid=${hid} onDone=${areaDone} onSkip=${() => setSkipArea(true)} /></section>`;
  if (!open.length) return html`<section class="card stack price-panel">${head}${prefRow}${areaRow}<span class="muted">אין מה להשוות: הרשימה ריקה או שהכול כבר נקנה.</span></section>`;
  if (!catalog) return html`<section class="card stack price-panel" aria-busy="true">${head}${prefRow}${areaRow}${err ? html`<span role="alert">${err} <button type="button" class="btn-text" onClick=${search}>לנסות שוב</button></span>` : html`<span class="muted">מחפשים מחירים ל-${open.length} מוצרים…</span>`}</section>`;

  const qtyOf = (c) => count((open.find((i) => i.id === c.id) || {}).qty, c.pick);
  const memoKey = [catalog, area, pref, strict, shownChains, clubs, open.map((i) => i.id + '|' + i.name + '|' + (i.barcode || '') + '|' + (i.qty || '')).join('§')];
  if (!memo.current.key || memoKey.some((k, n) => k !== memo.current.key[n])) {
    const choices = chooseAll(open.map((i) => ({ id: i.id, name: i.name, barcode: i.barcode })), withoutChains(nearby(catalog, !!area, area ? area.stores : null), hiddenChains(pref, shownChains)), pref, { strict });
    memo.current = { key: memoKey, choices, chains: basket(choices, qtyOf, new Date(), clubs) };
  }
  const { choices, chains } = memo.current;
  // "Which clubs do you have?": each chain in the comparison, its club and its credit card.
  const clubName = (c) => { const [k, kind] = c.split(':'); const r = chains.find((x) => x.chain === k); return (r ? r.name : k) + (kind === 'card' ? ' (אשראי)' : ''); };
  const clubsRow = editClubs ? html`<${ClubPicker} chains=${chains} initial=${clubs} onSave=${(n) => { saveClubs(n); setEditClubs(false); }} onCancel=${() => setEditClubs(false)} />`
    : html`<div class="price-pref pp-clubs-row"><span class="muted">מועדונים:</span><b class="price-pref-certs">${clubs.size ? [...clubs].map(clubName).join(' · ') : 'לא סימנתם'}</b>
      <button type="button" class="btn-text pp-area-edit" onClick=${() => setEditClubs(true)}>${clubs.size ? 'לשנות' : 'לסמן'}</button></div>`;
  const priced = choices.filter((c) => c.pick).length;
  const unsure = choices.filter((c) => c.status === 'unsure').length;
  const unverified = choices.filter((c) => c.status === 'unverified').length;
  const fresh = choices.filter((c) => c.status === 'fresh').length;
  const best = chains[0];
  const shown = chains.find((c) => c.chain === chainSel) || best;
  const save = saving(chains);
  const top = chains.slice(0, 5);
  const most = top.length ? Math.max(...top.map((c) => c.total + (c.gap || 0))) : 0;
  const lineAt = (c) => shown && shown.lines.find((l) => l.id === c.id);
  // When most of the list is not verified yet, the note above says it once
  // instead of a tag on every line.
  const quietK = unverified > choices.length / 2;
  const STATE = { auto: 'נבחר לבד', chosen: 'בחרתם', unverified: 'כשרות לא אומתה', unsure: 'בחרו מוצר', fresh: 'במשקל: לא בהשוואה' };
  return html`<section class="card stack price-panel">
    ${head}
    ${best ? html`<div class="pp-hero">
      <span class="pp-eye">הסל שלכם · ${priced} מוצרים</span>
      <span class="pp-big num">${fmt(shown.total)}</span>
      <span class="pp-at">ב${shown.name}${shown.store ? html` <small>· ${shown.store}</small>` : ''}${shown === best ? html` <em class="pp-best">הכי משתלם</em>` : ''}</span>
      ${chainNote(shown.chain) && html`<span class="pp-weekly"><${Icon} name=${chainNote(shown.chain).icon || 'calendar'} size=${15} /><span>${chainNote(shown.chain).text}${chainNote(shown.chain).url ? html` <a href=${chainNote(shown.chain).url} target="_blank" rel="noopener">לאתר שלהם</a>` : ''}</span></span>`}
      ${shown === best && bestAlways(chains) && html`<button type="button" class="pp-always" onClick=${() => setChainSel(bestAlways(chains).chain)}>${chainNote(best.chain).alt || 'בחנות שפתוחה כל יום'}: הכי משתלם ב${bestAlways(chains).name}, <b class="num">${fmt(bestAlways(chains).total)}</b></button>`}
      ${shown.missing > 0 && html`<span class="pp-missing">בלי ${shown.missing === 1 ? 'מוצר אחד שאין' : shown.missing + ' מוצרים שאין'} ב${shown.name}: ${shown.lines.filter((l) => !l.product).map((l) => (open.find((i) => i.id === l.id) || {}).name).filter(Boolean).slice(0, 4).join(', ')}${shown.missing > 4 ? ' ועוד' : ''}</span>`}
      ${area && !area.stores.length && html`<span class="pp-missing">אין חנות של אף רשת עד ${area.max_km || 25} ק"מ מ${area.city}, ולכן מוצגות רק רשתות אונליין (במשלוח). <button type="button" class="btn-text pp-inline" onClick=${() => setEditArea(true)}>להגדיל את המרחק</button></span>`}
      ${shown.saved > 0 && html`<span class="pp-deals"><${Icon} name="tag" size=${15} />כולל <b class="num">${fmt(shown.saved)}</b> הנחה במבצעים שכל אחד מקבל</span>`}
      ${shown === best && (() => { const t = twoChains(chains); if (!t) return ''; const names = (ids) => ids.map((id) => (open.find((i) => i.id === id) || {}).name).filter(Boolean);
        return html`<details class="pp-two"><summary>בשתי רשתות: <b class="num">${fmt(t.total)}</b>, עוד <b class="num">${fmt(t.saved)}</b> פחות</summary>
          <span>ב${t.b.name}: ${names(t.atB).join(', ')}</span><span>ב${t.a.name}: כל השאר</span></details>`; })()}
      ${save > 0 && shown === best && html`<span class="pp-save">חוסכים <b class="num">${fmt(save)}</b> לעומת המחיר האמצעי ברשתות</span>`}
      ${(() => { const text = chainListText(shown, open); const copy = async () => { try { await navigator.clipboard.writeText(text); showToast('הרשימה של ' + shown.name + ' הועתקה'); track('price_list_copy'); } catch (_e) { showToast('לא הצלחנו להעתיק.'); } };
        return html`<div class="pp-send"><span>לשלוח למי שהולך לקנות:</span><a class="btn-text" href=${'https://wa.me/?text=' + encodeURIComponent(text)} target="_blank" rel="noopener" onClick=${() => track('price_list_wa')}>וואטסאפ</a><button type="button" class="btn-text" onClick=${copy}>להעתיק</button></div>`; })()}
      <div class="pp-bars" role="group" aria-label="הסל בכל רשת: לבחור רשת">${top.map((c) => html`<button type="button" key=${c.chain} class=${'pp-bar' + (c === shown ? ' on' : '')} aria-pressed=${c === shown} onClick=${() => setChainSel(c.chain)}>
        <span class="pp-bar-n">${c.name}${chainNote(c.chain) && html`<small class="pp-bar-w">${chainNote(c.chain).short}</small>`}</span>
        <span class="pp-bar-t" aria-hidden="true"><i style=${'width:' + Math.max(8, Math.round((c.total / most) * 100)) + '%'}></i>${c.gap > 0 && html`<b class="pp-bar-gap" style=${'width:' + Math.round((c.gap / most) * 100) + '%'}></b>`}</span>
        <span class="pp-bar-v num">${fmt(c.total)}</span>
        ${(c.missing > 0 || c.swaps > 0 || c.delivery) && html`<small class="pp-bar-x">${[c.delivery ? 'כולל משלוח ' + (c.delivery.sure ? '' : 'בערך ') + fmt(c.delivery.fee) : '', c.missing ? 'בלי ' + (c.missing === 1 ? 'מוצר אחד' : c.missing + ' מוצרים') : '', c.swaps ? (c.swaps === 1 ? 'מוצר דומה אחד' : c.swaps + ' מוצרים דומים') : ''].filter(Boolean).join(' · ')}</small>`}
      </button>`)}</div>
    </div>` : area && !area.stores.length ? html`<div class="pp-empty"><b>אין סניף של אף רשת עד ${area.max_km || 25} ק"מ מ${area.city}</b><span class="muted">רשת רחוקה לא נכנסת להשוואה, כי לא באמת קונים בה. אפשר להגדיל את המרחק.</span><button type="button" class="btn btn-ghost" style="justify-self:start" onClick=${() => setEditArea(true)}>להגדיל את המרחק</button></div>`
      : html`<div class="pp-empty"><b>עוד אין מחירים לרשימה הזו</b><span class="muted">${looking ? 'מחפשים עכשיו…' : 'נסו לכתוב את המוצרים בשמות פשוטים: חלב 3%, קמח, אורז.'}</span></div>`}
    <details class="pp-set" open=${setOpen || editPref || editArea || editClubs} onToggle=${(e) => setSetOpen(e.currentTarget.open)}>
      <summary class="pp-set-sum"><${Icon} name="sliders" size=${15} /><span><b>הגדרות ההשוואה</b><small class="muted">${[Array.isArray(pref) ? (pref.length > 1 ? pref[0] + ' ועוד ' + (pref.length - 1) : pref[0]) : 'בלי העדפת כשרות', area ? area.city : 'מחירים כלליים', clubs.size ? (clubs.size === 1 ? 'מועדון אחד' : clubs.size + ' מועדונים') : '', strict ? 'רק כשרות שאומתה' : ''].filter(Boolean).join(' · ')}</small></span></summary>
      ${prefRow}${areaRow}${clubsRow}${shabbatRow}
      <label class="pp-strict"><input type="checkbox" checked=${strict} onChange=${(e) => setStrictPref(e.currentTarget.checked)} /> רק מוצרים שהכשרות שלהם אומתה</label></details>
    ${unverified > 0 && html`<p class="pp-note-k" role="note"><${Icon} name="shield" size=${16} /><span>${unverified === 1 ? 'במוצר אחד' : 'ב-' + unverified + ' מוצרים'} הכשרות עוד לא סומנה אצלנו. המחיר מחושב, ובחנות כדאי לבדוק את החותמת. סימון אחד שלכם ("מה כתוב על האריזה") עוזר לכל המשפחות.</span></p>`}
    <span class="muted price-count">יש מחיר: ${priced} מתוך ${open.length}${unsure ? ' · ' + unsure + ' מחכים לבחירה שלכם' : ''}${fresh ? ' · ' + (fresh === 1 ? 'אחד נמכר' : fresh + ' נמכרים') + ' במשקל' : ''}${looking ? ' · מחפשים עוד ' + looking + '…' : ''}</span>
    <ul class="price-list pp-list">
      ${choices.map((c) => { const item = open.find((i) => i.id === c.id); const expanded = openId === c.id || (c.status === 'unsure' && openId !== 'x:' + c.id); const at = lineAt(c); const paid = lastPaid(item.name, receipts, c.pick); const p = (at && at.product) || c.pick; return html`<li key=${c.id} class=${'price-item pp-row is-' + c.status + (expanded ? ' open' : '')}>
        <button type="button" class="pp-row-h" aria-expanded=${expanded} onClick=${() => setOpenId(expanded ? 'x:' + c.id : c.id)} disabled=${!c.options.length}>
          <${Photo} p=${p} name=${item.name} />
          <span class="pp-row-t"><b>${item.name}${item.qty ? html` <small class="shop-qty">${item.qty}</small>` : ''}</b>
            <small class="muted">${p ? p.name + (sizeText(sizeOfProduct(p)) ? ' · ' + sizeText(sizeOfProduct(p)) : '') : c.status === 'fresh' ? 'פירות, ירקות ובשר נמכרים במשקל, במחיר של הסניף' : looking ? 'מחפשים…' : queued ? 'עוד לא בקטלוג: נוסיף בקרוב' : c.status === 'unsure' ? 'יש מוצרים, אבל לא בכשרות שבחרתם' : 'לא נמצא מחיר'}</small>
            <span class="pp-tags">${p && !nonFood(p) && certOf(p) && html`<span class=${'pp-tag t-cert' + (MINE.includes(certOf(p).cert) ? ' fits' : '')}>${certOf(p).cert}</span>`}${c.status !== 'auto' && !(c.status === 'unverified' && quietK) ? html`<span class=${'pp-tag t-' + c.status}>${STATE[c.status] || 'אין מחיר'}</span>` : ''}${at && at.swap && html`<span class="pp-tag t-swap">מוצר דומה ב${shown.name}</span>`}${at && !at.product && c.pick && html`<span class="pp-tag t-miss">אין ב${shown.name}</span>`}${at && at.promo && html`<span class="pp-tag t-deal">מבצע: ${promoText(at.promo, at.price)}</span>`}${at && !at.promo && at.other && html`<span class="pp-tag t-deal-off">${offText(at.other)}</span>`}${paid && html`<span class="pp-tag t-paid">שילמתם ${fmt(paid.price)}${paid.store ? ' ב' + paid.store : ''}</span>`}</span></span>
          <span class="pp-row-p">${(() => { const n = qtyOf(c); const one = at && at.price ? at.price : c.pick && bestPrice(c.pick) ? bestPrice(c.pick).price : null; const where = !(at && at.price) && c.pick && bestPrice(c.pick) ? bestPrice(c.pick).chainName : '';
            // With a deal counted: what the line costs in it, the regular price struck out.
            const line = at && at.cost != null ? at.cost : one * n;
            return one === null ? html`<b class="num faint">—</b>` : html`<b class="num">${fmt(line)}</b>${line < one * n - 0.009 ? html`<s class="muted num">${fmt(one * n)}</s>` : n > 1 ? html`<small class="muted">${n} × ${fmt(one)}</small>` : ''}${where ? html`<small class="muted">${where}</small>` : ''}`; })()}</span>
        </button>
        ${at && !at.promo && at.other && (at.other.why === 'club' || at.other.why === 'card') && html`<div class="pp-club-ask"><button type="button" class="btn-text" onClick=${() => saveClubs(new Set([...clubs, baseChain(shown.chain) + ':' + at.other.why]), (at.other.why === 'card' ? 'מבצעי כרטיס האשראי של ' : 'מבצעי המועדון של ') + shown.name.replace(/ אונליין$/, '') + ' נכללים עכשיו בסכום')}>${at.other.why === 'card' ? 'יש לי את כרטיס האשראי של ' + shown.name.replace(/ אונליין$/, '') : 'אני במועדון של ' + shown.name.replace(/ אונליין$/, '')}: לכלול את המבצע</button></div>`}
        ${expanded && html`<div class="pp-more">
          ${c.status === 'unsure' && html`<span class="price-warn">מצאנו מוצרים, אבל לא ידוע שהכשרות שלהם מהרשימה שלכם. בחרו מוצר, או סמנו מה כתוב על האריזה:</span>`}
          <ul class="price-opts">${c.options.map((o) => html`<li key=${o.barcode}><${Product} p=${o}>
            ${c.pick && o.barcode === c.pick.barcode ? html`<span class="pp-chosen">נבחר</span>` : html`<button type="button" class="btn btn-ghost price-pick" onClick=${() => pick(item, o)}>לבחור</button>`}</${Product}>
            ${!certOf(o) && !nonFood(o) && html`<${Mark} p=${o} onVote=${vote} />`}</li>`)}</ul>
          ${c.pick && certOf(c.pick) && !nonFood(c.pick) && (voteId === c.id ? html`<${Mark} p=${c.pick} onVote=${vote} open />` : html`<button type="button" class="btn-text price-vote-open" onClick=${() => setVoteId(c.id)}>הכשרות לא נכונה?</button>`)}
        </div>`}
      </li>`; })}
    </ul>
    <p class="faint price-note">המחירים מהקבצים הרשמיים שהרשתות מפרסמות${area && area.stores.length ? ', מהסניף הקרוב אליכם בכל רשת' : ', מסניף אחד בכל רשת'}. רשת שאין בה בדיוק אותו מוצר מקבלת את המוצר הדומה הזול שלה באותו גודל, ורואים את זה ליד המוצר. הכשרות לפי מה שמשפחות סימנו, המאגר הפתוח ואישור שלנו, ולכן תמיד כדאי לבדוק את החותמת. ${PROMO_POLICY}</p>
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
    <span class="muted" style="font-size:14px;line-height:1.55">כותבים את הרשימה, ולכל מוצר נבחר לבד הזול ביותר בכשרות שלכם, ברשתות שיש להן סניף קרוב אליכם. רואים כמה כל הרשימה עולה בכל רשת, כולל המבצעים שבאמת תקבלו, ואיפה הכי משתלם לקנות.</span>
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
