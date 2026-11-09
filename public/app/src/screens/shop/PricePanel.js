import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { PREFS, LEVEL_NAMES, chooseAll, basket, bestPrice, levelOf, size, sizeText, count, kosherHint } from '../../domain/prices.js';
import { searchPrices, fetchPrices, fetchStatus, getKosherPref, setKosherPref, voteKosher, pickProduct } from '../../data/prices.js';
import { showToast } from '../../lib/toast.js';
import { track } from '../../lib/telemetry.js';

// "What will it cost": every item on the list gets one exact product (by
// barcode), picked automatically as the cheapest at the household's kashrut
// level, and the whole list is priced at each chain. Items with nothing in
// our catalog are looked up once, in the background.

const fmt = (n) => '₪' + (Math.round(n * 100) / 100).toFixed(2);

function Kosher({ p }) {
  const l = levelOf(p);
  if (l) {
    const who = l.by === 'owner' ? 'אושר על ידינו' : 'אישרו ' + (l.votes[l.level] || 0) + ' משפחות';
    return html`<span class=${'kosher kosher-' + l.level}>${LEVEL_NAMES[l.level]} · ${who}</span>`;
  }
  const hint = kosherHint(p.name);
  return html`<span class="kosher kosher-unknown">כשרות לא אושרה עדיין${hint ? ' (בשם כתוב "' + (hint === 'mehadrin' ? 'מהדרין' : 'כשר') + '")' : ''}</span>`;
}

function Product({ p, children }) {
  const b = bestPrice(p);
  const sz = sizeText(size(p.qty, p.unit));
  return html`<div class="price-prod">
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
  const [openId, setOpenId] = useState(null);
  const [voteId, setVoteId] = useState(null);
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
  const key = names.join('|');
  useEffect(() => { if (!pref) return; search().then((c) => c && lookUp(c)); }, [pref, key]);

  const choosePref = async (k) => {
    setPref(k);
    try { await setKosherPref(hid, k); } catch (_e) { showToast('ההעדפה לא נשמרה. נסו שוב.'); }
  };
  const pick = async (item, p) => {
    onPicked(item.id, p.barcode);
    setOpenId(null);
    track('price_pick');
    try { await pickProduct(item.id, p.barcode); } catch (_e) { showToast('הבחירה לא נשמרה. נסו שוב.'); }
  };
  const vote = async (p, level) => {
    try {
      await voteKosher(hid, p.barcode, level);
      const k = p.kosher || {};
      const votes = { ...(k.votes || {}) };
      if (k.mine) votes[k.mine] = Math.max(0, (votes[k.mine] || 1) - 1);
      votes[level] = (votes[level] || 0) + 1;
      setCatalog((c) => Object.fromEntries(Object.entries(c).map(([n, list]) => [n, list.map((x) => (x.barcode === p.barcode ? { ...x, kosher: { ...k, votes, mine: level } } : x))])));
      showToast('תודה! זה עוזר לכל המשפחות.');
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };

  const head = html`<div class="price-head"><b class="price-title"><${Icon} name="cart" size=${18} />כמה הרשימה תעלה</b>
    <button type="button" class="icon-btn" aria-label="לסגור את השוואת המחירים" onClick=${onClose}><${Icon} name="x" size=${16} /></button></div>`;
  const prefRow = html`<div class="price-pref"><span class="muted">כשרות:</span>
    <span class="seg" role="group" aria-label="רמת כשרות">${PREFS.map((x) => html`<button type="button" key=${x.key} aria-pressed=${pref === x.key} title=${x.note} onClick=${() => choosePref(x.key)}>${x.label}</button>`)}</span></div>`;

  if (pref === undefined) return html`<section class="card stack price-panel">${head}<span class="muted">רגע…</span></section>`;
  if (!pref) {
    return html`<section class="card stack price-panel">${head}
      <b>איזו כשרות אתם רוצים?</b>
      <span class="muted" style="line-height:1.55">המערכת תבחר לכל מוצר ברשימה את הזול ביותר ברמה הזאת. מוצר שהכשרות שלו עוד לא אושרה לא ייבחר לבד, אלא יסומן לכם לבחירה.</span>
      <div class="price-pref-pick">${PREFS.map((x) => html`<button type="button" class="card price-pref-btn" key=${x.key} onClick=${() => choosePref(x.key)}><b>${x.label}</b><small class="muted">${x.note}</small></button>`)}</div>
    </section>`;
  }
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
          <span class="price-state">${c.status === 'auto' ? 'נבחר אוטומטית' : c.status === 'chosen' ? 'בחרתם' : c.status === 'unsure' ? 'בחרו מוצר' : looking ? 'מחפשים…' : 'לא נמצא מחיר'}</span></div>
        ${c.pick && html`<${Product} p=${c.pick} />`}
        ${c.status === 'unsure' && html`<span class="price-warn">מצאנו מוצרים, אבל הכשרות שלהם עוד לא אושרה ל"${PREFS.find((x) => x.key === pref).label}". בחרו מוצר או אשרו את הכשרות שלו:</span>`}
        ${c.options.length > 0 && (c.status === 'unsure' || expanded) && html`<ul class="price-opts">${c.options.map((p) => html`<li key=${p.barcode}><${Product} p=${p}>
          <button type="button" class="btn btn-ghost price-pick" onClick=${() => pick(item, p)}>לבחור</button></${Product}>
          ${!levelOf(p) && html`<span class="price-vote"><small class="muted">יודעים מה הכשרות?</small>${['mehadrin', 'regular', 'none'].map((l) => html`<button type="button" class="chip" key=${l} onClick=${() => vote(p, l)}>${LEVEL_NAMES[l]}</button>`)}</span>`}</li>`)}</ul>`}
        ${c.pick && html`<span class="price-actions">
          ${c.options.length > 1 && html`<button type="button" class="btn-text" aria-expanded=${expanded} onClick=${() => setOpenId(expanded ? null : c.id)}>${expanded ? 'לסגור' : 'להחליף מוצר (' + (c.options.length - 1) + ')'}</button>`}
          ${levelOf(c.pick) && voteId !== c.id ? html`<button type="button" class="btn-text price-vote-open" onClick=${() => setVoteId(c.id)}>${c.pick.kosher && c.pick.kosher.mine ? 'אישרתם: ' + LEVEL_NAMES[c.pick.kosher.mine] + ' · לשנות' : 'הכשרות לא נכונה?'}</button>`
            : html`<span class="price-vote"><small class="muted">${c.pick.kosher && c.pick.kosher.mine ? 'אישרתם: ' + LEVEL_NAMES[c.pick.kosher.mine] + '. לשנות:' : 'מה הכשרות של המוצר?'}</small>${['mehadrin', 'regular', 'none'].map((l) => html`<button type="button" class="chip" key=${l} aria-pressed=${!!(c.pick.kosher && c.pick.kosher.mine === l)} onClick=${() => { setVoteId(null); vote(c.pick, l); }}>${LEVEL_NAMES[l]}</button>`)}</span>`}
        </span>`}
      </li>`; })}
    </ul>
    <p class="faint price-note">המחירים מהקבצים הרשמיים שהרשתות מפרסמות, מסניף אחד בכל רשת. בסניף שלכם המחיר יכול להיות מעט שונה. הכשרות לפי אישור של משפחות ושלנו, ולכן תמיד כדאי לבדוק את החותמת על המוצר.</p>
  </section>`;
}
