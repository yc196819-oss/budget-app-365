import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { Sheet } from '../../components/Sheet.js';
import { finishSplit, tripsWithItems, staleItems, compareReceipt, compareSummary, shopCategory } from '../../domain/shopTrips.js';
import { shortName } from '../../domain/receipts.js';
import { chainHe } from '../../domain/prices.js';
import { finishTrip, setTripExpense, attachReceipt, loadReceipt, loadTripItems, removeItems } from '../../data/shopTrips.js';
import { scanReceipt } from '../../data/receipts.js';
import { searchPrices, pricesByBarcode, getArea } from '../../data/prices.js';
import { money } from '../../domain/format.js';
import { showToast } from '../../lib/toast.js';
import { track } from '../../lib/telemetry.js';

// Shopping trips (the owner first): "סיימתי לקנות" keeps what was bought as
// one trip and leaves the rest on the list; the trips are a history; a
// receipt added to a trip is checked against our prices, and its total is
// the trip's expense until the card's statement brings the real charge.

const fmt = (n) => '₪' + (Math.round(Number(n) * 100) / 100).toFixed(2);
const MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const day = (iso) => { const d = new Date(iso); return { d: d.getDate(), m: MONTHS[d.getMonth()] }; };
const WHY = 'עם קבלה ההשוואה מדויקת יותר ונוכל לחסוך לכם יותר, וההוצאה נכנסת לבד להוצאות.';
const label = (s) => chainHe(s.chain_name || s.chain || '') || s.chain;

// Reads a receipt photo (a hidden file input, opened by a button).
function usePickReceipt(hid, onRead) {
  const ref = useRef(null);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState('');
  const onChange = async (e) => {
    const f = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    setErr(''); setReading(true);
    track('trip_receipt_scan');
    try { await onRead(await scanReceipt(hid, f)); } catch (ex) { setErr(ex.message || 'לא הצלחנו לקרוא את הקבלה.'); }
    setReading(false);
  };
  const input = html`<input ref=${ref} type="file" accept="image/*" class="sr-only" onChange=${onChange} aria-label="תמונה של קבלה" tabIndex="-1" />`;
  return { open: () => ref.current && ref.current.click(), input, reading, err };
}

// The trip's expense from a receipt (its total, or the sum of its lines).
const receiptTotal = (r) => Number(r.total) > 0 ? Number(r.total) : (r.items || []).reduce((s, it) => s + (Number(it.price) || 0), 0);

// "סיימתי לקנות": what was bought becomes a trip; what was not stays.
export function FinishSheet({ data, items, onClose, onDone }) {
  const { bought, left } = finishSplit(items);
  const [stores, setStores] = useState([]);
  const [chain, setChain] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { getArea(data.hid).then((a) => setStores(((a && a.stores) || []).filter((s, i, all) => all.findIndex((x) => x.chain === s.chain) === i))).catch(() => setStores([])); }, [data.hid]);
  const picked = stores.find((s) => s.chain === chain) || null;
  const chainName = picked ? label(picked) : null;
  const save = async (withReceipt) => {
    if (busy) return null;
    setBusy(true);
    try {
      let trip = await finishTrip(data.hid, { bought, left, chain: chain || null, chainName });
      const amount = Number(String(typed).replace(/[^\d.]/g, ''));
      if (amount > 0) trip = await setTripExpense(data.hid, trip, { amount, store: chainName, cat: shopCategory(data.txs, data.categories, chainName || '') });
      track('shop_trip_done', { left: left.length, total: amount > 0, receipt: withReceipt });
      showToast('הקנייה נשמרה. ' + (left.length ? left.length + ' מוצרים נשארו ברשימה.' : 'הרשימה ריקה.'));
      onDone(trip, withReceipt);
      return trip;
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); setBusy(false); return null; }
  };
  return html`<${Sheet} title="לשמור את הקנייה?" onClose=${onClose}>
    <div class="stack trip-finish">
      <div class="trip-split">
        <div class="trip-box ok"><b class="num">${bought.length}</b><span>נקנו. יישמרו בהיסטוריה</span></div>
        <div class="trip-box left"><b class="num">${left.length}</b><span>לא נקנו. נשארים ברשימה</span></div>
      </div>
      ${stores.length > 0 && html`<label class="trip-field">איפה קניתם?
        <select class="input" value=${chain} onChange=${(e) => setChain(e.currentTarget.value)} aria-label="באיזו רשת קניתם">
          <option value="">לא חשוב / רשת אחרת</option>
          ${stores.map((s) => html`<option key=${s.chain} value=${s.chain}>${label(s)}${s.name ? ' · ' + s.name : ''}</option>`)}
        </select></label>`}
      <label class="trip-field">כמה שילמתם? <small class="muted">לא חובה. בלי קבלה זו הערכה</small>
        <input class="input num" type="text" inputmode="decimal" placeholder="₪" value=${typed} onInput=${(e) => setTyped(e.currentTarget.value)} aria-label="כמה שילמתם" /></label>
      <p class="trip-why"><${Icon} name="receipt" size=${16} /> ${WHY}</p>
      <button type="button" class="btn" disabled=${busy} onClick=${() => save(true)}><${Icon} name="camera" size=${17} /> לשמור ולצרף קבלה</button>
      <button type="button" class="btn btn-ghost" disabled=${busy} onClick=${() => save(false)}>לשמור בלי קבלה</button>
      <small class="muted trip-later">אפשר לצרף קבלה גם אחר כך, מ"הקניות שלי".</small>
    </div>
  <//>`;
}

// The side card: the last trip and a way into the history.
export function TripsCard({ trips, onOpen }) {
  const last = trips[0];
  return html`<button type="button" class="card trips-card" onClick=${onOpen}>
    <span class="rcpt-ic" aria-hidden="true"><${Icon} name="clock" size=${19} /></span>
    <span><b>הקניות שלי</b><small class="muted">${last ? (trips.length === 1 ? 'קנייה אחת' : trips.length + ' קניות') + (last.receipt_id ? '' : ' · לאחרונה בלי קבלה') : 'כאן יישמרו הקניות שסיימתם'}</small></span>
    <span aria-hidden="true">‹</span>
  </button>`;
}

// What each status says, short.
const STATUS = { check: 'יקר מאצלנו', promo: 'במבצע', cheaper: 'זול מאצלנו', ok: 'כמו אצלנו', none: '' };

function CompareView({ receipt, trip }) {
  const [lines, setLines] = useState(null);
  useEffect(() => {
    let live = true;
    const opts = { chain: trip.chain, chainName: trip.chain_name || receipt.store };
    const items = (receipt.items || []).filter((l) => l.price > 0);
    // By the barcodes on the receipt first (exact); by name only what they
    // did not find.
    (async () => {
      const byCode = await pricesByBarcode(items.map((l) => l.code)).catch(() => ({}));
      const first = compareReceipt(receipt, {}, { ...opts, byCode });
      const names = [...new Set(items.filter((l, i) => first[i].ours == null).map((l) => shortName(l.name) || l.name))];
      const found = names.length ? await searchPrices(names).catch(() => ({})) : {};
      if (live) setLines(compareReceipt(receipt, found, { ...opts, byCode }));
    })().catch(() => { if (live) setLines([]); });
    return () => { live = false; };
  }, [receipt.id]);
  if (!lines) return html`<div class="muted trip-loading" role="status">משווים למחירים שלנו…</div>`;
  const s = compareSummary(lines);
  const order = { check: 0, promo: 1, cheaper: 2, ok: 3, none: 4 };
  const unit = (l) => (l.weighed ? html`<small class="muted trip-kg">לק"ג</small>` : '');
  return html`<div class="stack trip-compare">
    <div class="trip-sum">
      <div><b class="num">${fmt(receiptTotal(receipt))}</b><span>בקבלה</span></div>
      <div><b class="num">${s.known}/${s.total}</b><span>מוצרים הושוו</span></div>
      <div class=${s.check ? 'warn' : 'good'}><b class="num">${s.check || '✓'}</b><span>${s.check ? 'לבדוק' : 'אין חיוב יתר'}</span></div>
    </div>
    ${s.known > 0 && html`<p class="trip-fair">על ${s.known} המוצרים שהושוו שילמתם <b class="num">${fmt(s.paid)}</b>. במחיר הרגיל אצלנו הם <b class="num">${fmt(s.ours)}</b>${s.saved > 0 ? html`, כלומר <b class="good-t">חסכתם ${fmt(s.saved)}</b> במבצעים` : ''}.</p>`}
    <table class="trip-table"><thead><tr><th>מוצר</th><th>שילמתם</th><th>אצלנו</th></tr></thead><tbody>
      ${[...lines].sort((a, b) => order[a.status] - order[b.status]).map((l, i) => html`<tr key=${i} class=${'st-' + l.status}>
        <td><span class="dot" aria-hidden="true"></span>${l.name}${STATUS[l.status] && html`<small class="trip-st">${STATUS[l.status]}${l.promo && l.status !== 'ok' ? ' · ' + l.promo : ''}${l.by === 'name' ? ' · לפי שם' : ''}</small>`}</td>
        <td class="num">${fmt(l.paid)}${unit(l)}</td>
        <td class="num">${l.ours != null ? html`${fmt(l.ours)}${unit(l)}` : html`<small class="muted">${l.other ? 'מוצר אחר?' : 'אין אצלנו'}</small>`}</td>
      </tr>`)}
    </tbody></table>
    <small class="muted">"אצלנו" הוא המחיר הרגיל ברשת. "במבצע": שילמתם פחות, ויש עכשיו מבצע ברשת. "זול מאצלנו": שילמתם פחות בלי מבצע שאנחנו מכירים (אולי מבצע בסניף). "לבדוק": שילמתם יותר מ-15% או מ-3 ₪ מעל המחיר שלנו.</small>
  </div>`;
}

function TripView({ data, trip, onBack, onChanged }) {
  const [items, setItems] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadTripItems(data.hid, trip.id).then(setItems).catch(() => setItems([])); }, [trip.id]);
  useEffect(() => { if (trip.receipt_id) loadReceipt(trip.receipt_id).then(setReceipt).catch(() => {}); }, [trip.receipt_id]);
  const pick = usePickReceipt(data.hid, async (r) => {
    setBusy(true);
    try {
      const saved = await attachReceipt(data.hid, trip, r);
      const store = trip.chain_name || r.store;
      const next = await setTripExpense(data.hid, { ...trip, receipt_id: saved.id }, { amount: receiptTotal(r), date: r.date, store, cat: shopCategory(data.txs, data.categories, store || '') });
      setReceipt(saved);
      onChanged({ ...next, receipt_id: saved.id });
      track('trip_receipt_save');
      showToast('הקבלה נשמרה, וההוצאה נכנסה להוצאות.');
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy(false);
  });
  const { d, m } = day(trip.finished_at);
  return html`<div class="stack trip-view">
    <button type="button" class="btn-text trip-back" onClick=${onBack}>→ לכל הקניות</button>
    <div class="trip-title"><b>${trip.chain_name || 'קנייה'}</b><span class="muted">${d} ב${m}${trip.total ? ' · ' + money(trip.total) : ''}</span></div>
    ${receipt ? html`<${CompareView} receipt=${receipt} trip=${trip} />` : html`<div class="trip-nudge">
      <b>עוד אין קבלה לקנייה הזאת</b>
      <span>${WHY}</span>
      ${pick.input}
      <button type="button" class="btn" disabled=${busy || pick.reading} onClick=${pick.open}><${Icon} name="camera" size=${17} /> ${pick.reading ? 'קוראים את הקבלה…' : busy ? 'שומרים…' : 'לצרף קבלה'}</button>
      ${pick.err && html`<span class="price-warn" role="alert">${pick.err}</span>`}
    </div>`}
    <div class="stack" style="gap:6px">
      <b>מה נקנה ${items ? '(' + items.length + ')' : ''}</b>
      <div class="chips">${(items || []).map((i) => html`<span class="chip" key=${i.id}>${i.name}</span>`)}</div>
    </div>
  </div>`;
}

// "הקניות שלי": what is left to buy, the trips, and one trip with its receipt.
export function TripsSheet({ data, trips, items, start = null, onClose, onChanged, onRemoved }) {
  const [open, setOpen] = useState(start);
  const left = items.filter((i) => !i.cleared_at && !i.done);
  const stale = staleItems(items, trips);
  const list = tripsWithItems(trips, items);
  const drop = async () => {
    try { await removeItems(data.hid, stale.map((i) => i.id)); onRemoved(stale.map((i) => i.id)); showToast('הורדו מהרשימה: ' + stale.map((i) => i.name).join(', ')); } catch (_e) { showToast('לא נמחק. נסו שוב.'); }
  };
  const cur = open && list.find((t) => t.id === open);
  return html`<${Sheet} title="הקניות שלי" onClose=${onClose} full>
    ${cur ? html`<${TripView} data=${data} trip=${cur} onBack=${() => setOpen(null)} onChanged=${onChanged} />` : html`<div class="stack trips">
      ${left.length > 0 && html`<div class="trip-left">
        <div class="sec-row"><b>נשאר להשלים · ${left.length}</b><button type="button" class="btn-text" onClick=${onClose}>לרשימה ‹</button></div>
        <div class="chips">${left.slice(0, 8).map((i) => html`<span class="chip" key=${i.id}>${i.name}</span>`)}${left.length > 8 && html`<span class="chip">+${left.length - 8}</span>`}</div>
        ${stale.length > 0 && html`<div class="trip-stale" role="note"><${Icon} name="alert" size=${15} />
          <span>${stale.length === 1 ? '"' + stale[0].name + '" לא נקנה' : stale.map((i) => '"' + i.name + '"').join(', ') + ' לא נקנו'} 3 קניות ברצף.</span>
          <button type="button" class="btn-text" onClick=${drop}>להוריד מהרשימה?</button></div>`}
      </div>`}
      ${list.length === 0 ? html`<div class="card empty"><span>עוד אין קניות שמורות. כשתלחצו "סיימתי לקנות", הקנייה תישמר כאן.</span></div>`
        : html`<div class="card trip-list">${list.map((t) => { const { d, m } = day(t.finished_at); return html`<button type="button" class="trip-row" key=${t.id} onClick=${() => setOpen(t.id)}>
          <span class="trip-date"><b class="num">${d}</b><small>${m}</small></span>
          <span class="trip-what"><b>${t.chain_name || 'קנייה'}</b><small class="muted">${t.bought} מוצרים${t.left_over ? ' · ' + t.left_over + ' נשארו' : ''}${t.total ? ' · ' + money(t.total) : ''}</small></span>
          <span class=${'tag ' + (t.receipt_id ? 'tg' : 'tn')}>${t.receipt_id ? 'עם קבלה' : 'בלי קבלה'}</span>
        </button>`; })}</div>`}
    </div>`}
  <//>`;
}
