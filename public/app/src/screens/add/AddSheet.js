import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { CatIcon } from '../../components/CatIcon.js';
import { Segmented } from '../../components/Segmented.js';
import { Icon } from '../../components/Icon.js';
import { guessCategory, frequentMerchants } from '../../domain/money.js';
import { parseSpoken, splitSpoken, toReviewItems, reviewToTx, CURRENCIES } from '../../domain/voice.js';
import { money } from '../../domain/format.js';
import { addTransaction, deleteNow } from '../../data/household.js';
import { canListen, listen } from '../../lib/speech.js';
import { showToast } from '../../lib/toast.js';
import { VoiceReview } from './VoiceReview.js';
import { activeCards, defaultCard, paidWith, cardLabel } from '../../domain/cards.js';
import { readLocal, writeLocal } from '../../lib/storage.js';

// Free text ("46 קפה בארומה") or voice. A recording can hold several
// transactions ("80 בסופר, 46 קפה, וקיבלתי משכורת 21 אלף"): they are split
// and shown as cards to check, edit or remove before anything is saved.
// Saying "קיבלתי…" makes it income. The category is taken from the last time
// the merchant appeared. One-tap buttons for what the household buys most.
export function AddSheet({ data, onClose, onImport }) {
  const [text, setText] = useState('');
  const [type, setType] = useState('expense');
  // Once the person taps expense/income themselves, their choice wins.
  const [chosen, setChosen] = useState(false);
  // The currency typed amounts are in (dollars, euros… are converted by the date's rate).
  const [currency, setCurrency] = useState('ILS');
  const [busy, setBusy] = useState(false);
  // The card an expense was paid with; starts with the one used last.
  const cards = activeCards(data.cards);
  const lastCardKey = 'lastCard:' + data.hid;
  const [cardId, setCardId] = useState(() => defaultCard(cards, readLocal(lastCardKey)));
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [voiceError, setVoiceError] = useState('');
  // Cards to check before saving: null, or { items, unclear }.
  const [review, setReview] = useState(null);
  const inputRef = useRef(null);
  const stopRef = useRef(null);
  const liveRef = useRef(null);
  // The recording: earlier sessions (phones stop listening after a pause and
  // we start again), the current session's final words, what is still being
  // recognized, and whether the person pressed stop.
  const earlier = useRef('');
  const [sessionText, setSessionText] = useState('');
  const session = useRef('');
  const stopAsked = useRef(false);
  const failed = useRef(false);
  const restarts = useRef(0);
  const transcript = (earlier.current + ' ' + sessionText).trim();
  useEffect(() => { if (liveRef.current) liveRef.current.scrollTop = liveRef.current.scrollHeight; }, [sessionText, heard]);
  useEffect(() => { inputRef.current && inputRef.current.focus(); return () => stopRef.current && stopRef.current(); }, []);

  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const history = (kind) => data.txs.filter((t) => (t.type === 'income') === (kind === 'income'));
  const guess = (description, kind) => guessCategory(description, history(kind));
  const parsed = parseSpoken(text);
  const split = splitSpoken(text);
  // "קיבלתי…" typed or dictated through the keyboard is income too.
  const kind = chosen ? type : type === 'income' || (parsed && parsed.type === 'income') ? 'income' : 'expense';
  const g = parsed ? guess(parsed.description, kind) : null;
  const guessCat = g ? byId.get(g.subcategory_id) || byId.get(g.category_id) : null;
  const guessTop = g ? byId.get(g.category_id) : null;
  const quick = kind === 'expense' ? frequentMerchants(data.txs, new Date()) : [];

  const openReview = (said) => {
    const s = splitSpoken(said);
    if (!s.items.length) { setVoiceError('שמעתי: "' + said + '". לא מצאתי סכום. אפשר לתקן בתיבה או להקליט שוב.'); setText(said); return; }
    // A manual choice of type applies to everything heard; so does a chosen currency.
    const items = s.items.map((it) => ({ ...it, ...(chosen ? { type } : {}), ...(currency !== 'ILS' && !it.currency ? { currency } : {}) }));
    setReview((prev) => {
      const before = prev ? prev.items : [];
      const fresh = toReviewItems(items, guess).map((it, i) => ({ ...it, key: 'v' + (before.length + i) + '-' + Date.now() }));
      return { items: [...before, ...fresh], unclear: [...(prev ? prev.unclear : []), ...s.unclear] };
    });
    setText('');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };

  const startSession = () => {
    session.current = ''; setSessionText(''); setHeard('');
    stopRef.current = listen({
      continuous: true,
      onInterim: setHeard,
      onText: (t) => { session.current = t; setSessionText(t); },
      onEnd: () => {
        stopRef.current = null;
        earlier.current = (earlier.current + ' ' + session.current).trim();
        session.current = ''; setSessionText(''); setHeard('');
        // The phone stopped by itself after a pause: keep listening until ⏹.
        if (!stopAsked.current && !failed.current && restarts.current < 30) {
          restarts.current += 1;
          try { startSession(); return; } catch (_err) { /* fall through and finish */ }
        }
        setListening(false);
        const said = earlier.current.trim();
        earlier.current = '';
        if (said) openReview(said);
      },
      onError: (e) => {
        if (e === 'no-speech' && !stopAsked.current) return; // a pause: onEnd restarts
        failed.current = true;
        setVoiceError(e === 'not-allowed' || e === 'service-not-allowed' ? 'צריך לאשר גישה למיקרופון בהגדרות הדפדפן.' : e === 'no-speech' ? 'לא שמעתי. לחצו ונסו שוב.' : 'לא הצלחתי לשמוע. נסו שוב או כתבו בתיבה.');
      }
    });
  };

  const mic = () => {
    if (listening) { stopAsked.current = true; stopRef.current && stopRef.current(); return; }
    setVoiceError(''); earlier.current = ''; stopAsked.current = false; failed.current = false; restarts.current = 0;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    try {
      startSession();
      setListening(true);
    } catch (_err) {
      setVoiceError('לא הצלחתי להפעיל את המיקרופון. אפשר להכתיב עם המיקרופון שבמקלדת.');
    }
  };

  const saveAll = async (txs) => {
    if (busy || !txs.length) return;
    setBusy(true);
    const added = [];
    try {
      const paid = paidWith(cards.find((c) => c.id === cardId));
      for (const tx of txs) added.push(await addTransaction({ ...tx, paid }));
      if (cards.length) writeLocal(lastCardKey, cardId || '');
      onClose();
      const undo = () => Promise.all(added.map((r) => deleteNow(r.id))).catch(() => showToast('הביטול נכשל. אפשר למחוק מהרשימה.'));
      showToast(added.length === 1 ? 'נוסף: ' + added[0].description + ' ' + money(added[0].amount) : 'נוספו ' + added.length + ' תנועות', { undo });
    } catch (_err) {
      setBusy(false);
      if (review && added.length) setReview({ ...review, items: review.items.slice(added.length) });
      showToast(added.length ? 'נוספו ' + added.length + ', השאר לא נשמרו. נסו שוב.' : 'ההוספה נכשלה. נסו שוב.');
    }
  };
  const fromText = () => {
    // Several transactions, or a foreign amount (it needs the date's rate): check first.
    if (split.items.length > 1 || (parsed && (parsed.currency || currency !== 'ILS'))) { openReview(text); return; }
    if (parsed) saveAll([{ type: kind, amount: parsed.amount, description: parsed.description, category_id: g ? g.category_id : null, subcategory_id: g ? g.subcategory_id : null }]);
  };

  if (review) {
    return html`<${Sheet} title="בדיקה לפני הוספה" onClose=${onClose} full=${true}>
      ${!listening && review.items.some((it) => it.type !== 'income') && html`<${PaidWith} cards=${cards} value=${cardId} onChange=${setCardId} />`}
      <${VoiceReview} items=${review.items} unclear=${review.unclear} categories=${data.categories} busy=${busy}
        onChange=${(next) => setReview((r) => ({ ...r, items: typeof next === 'function' ? next(r.items) : next }))}
        onSave=${() => saveAll(review.items.map((it) => reviewToTx(it, data.categories)))}
        onCancel=${() => { setReview(null); setVoiceError(''); }}
        onMore=${canListen() ? mic : null} />
      ${listening && html`<${LiveTranscript} text=${transcript} interim=${heard} liveRef=${liveRef} onStop=${mic} />`}
    <//>`;
  }

  return html`<${Sheet} title=${kind === 'income' ? 'הוספת הכנסה' : 'הוספת הוצאה'} onClose=${onClose}>
    <${Segmented} label="סוג" value=${kind} onChange=${(k) => { setType(k); setChosen(true); }} options=${[{ key: 'expense', label: 'הוצאה' }, { key: 'income', label: 'הכנסה' }]} />
    <label class="field"><span>סכום ומה ${kind === 'income' ? 'נכנס' : 'קניתם'}, בכל סדר${canListen() ? ', או בקול' : ''}</span>
      <span class="add-input">
        <input ref=${inputRef} class="input" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') fromText(); }}
          placeholder=${kind === 'income' ? 'למשל: 500 החזר מביטוח לאומי' : 'למשל: 46 קפה בארומה'} enterkeyhint="done" disabled=${listening} />
        <select class="input cur-select" value=${currency} aria-label="מטבע" onChange=${(e) => setCurrency(e.target.value)} disabled=${listening}>
          ${Object.entries(CURRENCIES).map(([code, c]) => html`<option value=${code}>${c.symbol}</option>`)}
        </select>
        ${canListen() && html`<button type="button" class=${'icon-btn add-mic' + (listening ? ' on' : '')} aria-label=${listening ? 'לסיים הקלטה' : 'להוסיף בקול'} aria-pressed=${String(listening)} onClick=${mic}>${listening ? '⏹' : '🎙️'}</button>`}
      </span>
    </label>
    ${listening && html`<${LiveTranscript} text=${transcript} interim=${heard} liveRef=${liveRef} onStop=${mic} />`}
    ${voiceError && html`<span class="hint" role="alert" style="color:var(--danger)">${voiceError}</span>`}
    ${kind === 'expense' && !listening && html`<${PaidWith} cards=${cards} value=${cardId} onChange=${setCardId} />`}
    ${!canListen() && html`<span class="hint">להוספה בקול: לחצו על המיקרופון שבמקלדת של הטלפון ודברו. אפשר כמה תנועות ברצף.</span>`}
    ${!listening && split.items.length > 1 && html`<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span>נמצאו <b>${split.items.length}</b> תנועות</span><button type="button" class="btn" style="flex:none" onClick=${() => openReview(text)}>לבדוק ולהוסיף</button></div>`}
    ${!listening && split.items.length <= 1 && parsed && html`<div class="row" style="background:var(--surface);border-radius:var(--radius-m)">
      <${CatIcon} category=${guessTop || guessCat} />
      <span class="row-main"><b>${parsed.description}</b><span>${guessCat ? guessCat.name + ' · כמו בפעם הקודמת' : 'בלי קטגוריה · אפשר לבחור אחר כך'} · היום</span></span>
      <span class="amt num">${parsed.currency || currency !== 'ILS' ? CURRENCIES[parsed.currency || currency].symbol + parsed.amount : money(parsed.amount)}</span>
    </div>`}
    ${!listening && parsed && (parsed.currency || currency !== 'ILS') && html`<span class="hint">יומר לשקלים לפי השער היציג של יום התנועה. בלחיצה על "להוסיף" תראו את הסכום בשקלים ותוכלו לשנות תאריך.</span>`}
    ${split.items.length <= 1 && html`<button type="button" class="btn" disabled=${!parsed || busy || listening} onClick=${fromText}>${busy ? 'מוסיף…' : 'להוסיף'}</button>`}
    ${quick.length > 0 && !listening && html`<div style="display:flex;flex-direction:column;gap:8px">
      <b style="font-size:13px;color:var(--muted)">בלחיצה אחת · מה שאתם קונים הכי הרבה</b>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
        ${quick.map((q) => html`<button type="button" class="chip" style="height:48px;justify-content:space-between;border-radius:14px" disabled=${busy}
            onClick=${() => saveAll([{ type: 'expense', amount: q.amount, description: q.description, category_id: q.category_id, subcategory_id: q.subcategory_id }])}>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${q.description}</span><b class="num">${money(q.amount)}</b>
        </button>`)}
      </div>
    </div>`}
    ${onImport && html`<button type="button" class="btn-text" style="color:var(--accent);display:flex;align-items:center;justify-content:center;gap:6px" onClick=${onImport}>
      <${Icon} name="upload" size=${17} />או: העלאת פירוט חודשי של כרטיס</button>`}
  <//>`;
}

// Which card paid for the expense (or none: cash, transfer, standing order).
// Only the card's name and last digits are shown.
function PaidWith({ cards, value, onChange }) {
  if (!cards.length) return null;
  return html`<div class="field"><span>שולם ב</span>
    <div class="pay-chips" role="group" aria-label="שולם ב">
      ${cards.map((c) => html`<button type="button" class="chip" aria-pressed=${String(value === c.id)} onClick=${() => onChange(c.id)}>💳 ${cardLabel(c)}</button>`)}
      <button type="button" class="chip" aria-pressed=${String(!value)} onClick=${() => onChange(null)}>לא בכרטיס</button>
    </div></div>`;
}

// Everything heard so far, all of it (not one line), the words still being
// recognized in a lighter shade, and a clear stop button.
function LiveTranscript({ text, interim, liveRef, onStop }) {
  return html`<div class="card listen-card" role="status" aria-live="polite">
    <div class="listen-head"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><b>מקשיב…</b>
      <button type="button" class="btn listen-stop" onClick=${onStop}>⏹ סיימתי</button></div>
    <div class="live-transcript" ref=${liveRef}>
      ${text || interim ? html`${text}${interim ? html` <span class="interim">${interim}</span>` : ''}` : html`<span class="faint">אפשר לומר כמה תנועות ברצף, למשל: "80 בסופר, 46 קפה, וקיבלתי משכורת 21 אלף". בסיום לחצו "סיימתי".</span>`}
    </div>
  </div>`;
}
