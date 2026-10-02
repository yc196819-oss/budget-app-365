import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { CatIcon } from '../../components/CatIcon.js';
import { Segmented } from '../../components/Segmented.js';
import { Icon } from '../../components/Icon.js';
import { guessCategory, frequentMerchants } from '../../domain/money.js';
import { parseSpoken, splitSpoken, toReviewItems, reviewToTx } from '../../domain/voice.js';
import { money } from '../../domain/format.js';
import { addTransaction, deleteNow } from '../../data/household.js';
import { canListen, listen } from '../../lib/speech.js';
import { showToast } from '../../lib/toast.js';
import { VoiceReview } from './VoiceReview.js';

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
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [voiceError, setVoiceError] = useState('');
  // Cards to check before saving: null, or { items, unclear }.
  const [review, setReview] = useState(null);
  const inputRef = useRef(null);
  const stopRef = useRef(null);
  const spoken = useRef('');
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
    // A manual choice of type applies to everything heard.
    const items = chosen ? s.items.map((it) => ({ ...it, type })) : s.items;
    setReview((prev) => {
      const before = prev ? prev.items : [];
      const fresh = toReviewItems(items, guess).map((it, i) => ({ ...it, key: 'v' + (before.length + i) + '-' + Date.now() }));
      return { items: [...before, ...fresh], unclear: [...(prev ? prev.unclear : []), ...s.unclear] };
    });
    setText('');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };

  const mic = () => {
    if (listening) { stopRef.current && stopRef.current(); return; }
    setVoiceError(''); setHeard(''); spoken.current = '';
    try {
      stopRef.current = listen({
        continuous: true,
        onInterim: setHeard,
        onText: (t) => { spoken.current = (spoken.current + ' ' + t).trim(); setHeard(''); },
        onEnd: () => {
          setListening(false); stopRef.current = null; setHeard('');
          const said = spoken.current.trim();
          if (said) openReview(said);
        },
        onError: (e) => { setVoiceError(e === 'not-allowed' || e === 'service-not-allowed' ? 'צריך לאשר גישה למיקרופון בהגדרות הדפדפן.' : e === 'no-speech' ? 'לא שמעתי. לחצו ונסו שוב.' : 'לא הצלחתי לשמוע. נסו שוב או כתבו בתיבה.'); }
      });
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
      for (const tx of txs) added.push(await addTransaction(tx));
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
    if (split.items.length > 1) { openReview(text); return; }
    if (parsed) saveAll([{ type: kind, amount: parsed.amount, description: parsed.description, category_id: g ? g.category_id : null, subcategory_id: g ? g.subcategory_id : null }]);
  };

  if (review) {
    return html`<${Sheet} title="בדיקה לפני הוספה" onClose=${onClose}>
      <${VoiceReview} items=${review.items} unclear=${review.unclear} categories=${data.categories} busy=${busy}
        onChange=${(items) => setReview({ ...review, items })}
        onSave=${() => saveAll(review.items.map((it) => reviewToTx(it, data.categories)))}
        onCancel=${() => { setReview(null); setVoiceError(''); }}
        onMore=${canListen() ? mic : null} />
      ${listening && html`<span class="hint" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> מקשיב… ${heard} <button type="button" class="btn-text" onClick=${mic}>לסיים</button></span>`}
    <//>`;
  }

  return html`<${Sheet} title=${kind === 'income' ? 'הוספת הכנסה' : 'הוספת הוצאה'} onClose=${onClose}>
    <${Segmented} label="סוג" value=${kind} onChange=${(k) => { setType(k); setChosen(true); }} options=${[{ key: 'expense', label: 'הוצאה' }, { key: 'income', label: 'הכנסה' }]} />
    <label class="field"><span>סכום ומה ${kind === 'income' ? 'נכנס' : 'קניתם'}, בכל סדר${canListen() ? ', או בקול' : ''}</span>
      <span class="add-input">
        <input ref=${inputRef} class="input" value=${listening && heard ? (spoken.current + ' ' + heard).trim() : listening ? spoken.current : text} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') fromText(); }}
          placeholder=${listening ? 'מקשיב…' : kind === 'income' ? 'למשל: 500 החזר מביטוח לאומי' : 'למשל: 46 קפה בארומה'} enterkeyhint="done" readOnly=${listening} />
        ${canListen() && html`<button type="button" class=${'icon-btn add-mic' + (listening ? ' on' : '')} aria-label=${listening ? 'לסיים הקלטה' : 'להוסיף בקול'} aria-pressed=${String(listening)} onClick=${mic}>${listening ? '⏹' : '🎙️'}</button>`}
      </span>
    </label>
    ${listening && html`<div class="card listen-card" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>מקשיב… אפשר לומר כמה תנועות ברצף, למשל: "80 בסופר, 46 קפה, וקיבלתי משכורת 21 אלף". בסיום לחצו ⏹.</span></div>`}
    ${voiceError && html`<span class="hint" role="alert" style="color:var(--danger)">${voiceError}</span>`}
    ${!canListen() && html`<span class="hint">להוספה בקול: לחצו על המיקרופון שבמקלדת של הטלפון ודברו. אפשר כמה תנועות ברצף.</span>`}
    ${!listening && split.items.length > 1 && html`<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span>נמצאו <b>${split.items.length}</b> תנועות</span><button type="button" class="btn" style="flex:none" onClick=${() => openReview(text)}>לבדוק ולהוסיף</button></div>`}
    ${!listening && split.items.length <= 1 && parsed && html`<div class="row" style="background:var(--surface);border-radius:var(--radius-m)">
      <${CatIcon} category=${guessTop || guessCat} />
      <span class="row-main"><b>${parsed.description}</b><span>${guessCat ? guessCat.name + ' · כמו בפעם הקודמת' : 'בלי קטגוריה · אפשר לבחור אחר כך'} · היום</span></span>
      <span class="amt num">${money(parsed.amount)}</span>
    </div>`}
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
