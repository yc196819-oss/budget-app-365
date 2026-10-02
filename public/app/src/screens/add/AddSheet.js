import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { CatIcon } from '../../components/CatIcon.js';
import { Segmented } from '../../components/Segmented.js';
import { Icon } from '../../components/Icon.js';
import { guessCategory, frequentMerchants } from '../../domain/money.js';
import { parseSpoken } from '../../domain/voice.js';
import { canListen, listen } from '../../lib/speech.js';
import { money } from '../../domain/format.js';
import { addTransaction, deleteNow } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// Free text ("46 קפה בארומה") or voice ("שילמתי שמונים שקל בסופר"), Enter
// adds. Saying "קיבלתי…" switches to income. The category is taken from the
// last time this merchant appeared. One-tap buttons for what the household
// buys most often.
export function AddSheet({ data, onClose, onImport }) {
  const [text, setText] = useState('');
  const [type, setType] = useState('expense');
  // Once the person taps expense/income themselves, their choice wins.
  const [chosen, setChosen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const inputRef = useRef(null);
  const stopRef = useRef(null);
  useEffect(() => { inputRef.current && inputRef.current.focus(); return () => stopRef.current && stopRef.current(); }, []);

  const mic = () => {
    if (listening) { stopRef.current && stopRef.current(); return; }
    setVoiceError(''); setHeard('');
    try {
      stopRef.current = listen({
        onInterim: setHeard,
        onText: (t) => {
          setHeard('');
          const p = parseSpoken(t);
          setText(p ? p.amount + ' ' + p.description : t);
          if (p) setType(p.type);
          else setVoiceError('שמעתי: "' + t + '". חסר סכום, אפשר לתקן בתיבה.');
        },
        onEnd: () => { setListening(false); stopRef.current = null; },
        onError: (e) => { setListening(false); setVoiceError(e === 'not-allowed' || e === 'service-not-allowed' ? 'צריך לאשר גישה למיקרופון בהגדרות הדפדפן.' : e === 'no-speech' ? 'לא שמעתי. לחצו ונסו שוב.' : 'לא הצלחתי לשמוע. נסו שוב או כתבו בתיבה.'); }
      });
      setListening(true);
    } catch (_err) {
      setVoiceError('לא הצלחתי להפעיל את המיקרופון. אפשר להכתיב עם המיקרופון שבמקלדת.');
    }
  };

  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const parsed = parseSpoken(text);
  // "קיבלתי…" typed or dictated through the keyboard is income too.
  const kind = chosen ? type : type === 'income' || (parsed && parsed.type === 'income') ? 'income' : 'expense';
  const guess = parsed ? guessCategory(parsed.description, data.txs.filter((t) => (t.type === 'income') === (kind === 'income'))) : null;
  const guessCat = guess ? byId.get(guess.subcategory_id) || byId.get(guess.category_id) : null;
  const guessTop = guess ? byId.get(guess.category_id) : null;
  const quick = kind === 'expense' ? frequentMerchants(data.txs, new Date()) : [];

  const save = async (item) => {
    if (busy || !item) return;
    setBusy(true);
    try {
      const row = await addTransaction({ type: item.type || kind, ...item });
      onClose();
      showToast('נוסף: ' + row.description + ' ' + money(row.amount), {
        undo: () => deleteNow(row.id).catch(() => showToast('הביטול נכשל. אפשר למחוק את התנועה מהרשימה.'))
      });
    } catch (_err) {
      setBusy(false);
      showToast('ההוספה נכשלה. נסו שוב.');
    }
  };
  const fromText = () => parsed && save({ type: kind, amount: parsed.amount, description: parsed.description, category_id: guess ? guess.category_id : null, subcategory_id: guess ? guess.subcategory_id : null });

  return html`<${Sheet} title=${kind === 'income' ? 'הוספת הכנסה' : 'הוספת הוצאה'} onClose=${onClose}>
    <${Segmented} label="סוג" value=${kind} onChange=${(k) => { setType(k); setChosen(true); }} options=${[{ key: 'expense', label: 'הוצאה' }, { key: 'income', label: 'הכנסה' }]} />
    <label class="field"><span>סכום ומה ${type === 'income' ? 'נכנס' : 'קניתם'}, בכל סדר${canListen() ? ', או בקול' : ''}</span>
      <span class="add-input">
        <input ref=${inputRef} class="input" value=${listening && heard ? heard : text} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') fromText(); }}
          placeholder=${listening ? 'מקשיב… למשל: שילמתי 80 שקל בסופר' : type === 'income' ? 'למשל: 500 החזר מביטוח לאומי' : 'למשל: 46 קפה בארומה'} enterkeyhint="done" />
        ${canListen() && html`<button type="button" class=${'icon-btn add-mic' + (listening ? ' on' : '')} aria-label=${listening ? 'להפסיק להקליט' : 'להוסיף בקול'} aria-pressed=${String(listening)} onClick=${mic}>🎙️</button>`}
      </span>
    </label>
    ${listening && html`<span class="hint" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> מקשיב… אמרו סכום ועל מה, למשל "קיבלתי משכורת 21 אלף"</span>`}
    ${voiceError && html`<span class="hint" role="alert" style="color:var(--danger)">${voiceError}</span>`}
    ${!canListen() && html`<span class="hint">להוספה בקול: לחצו על המיקרופון שבמקלדת של הטלפון ודברו.</span>`}
    ${parsed && html`<div class="row" style="background:var(--surface);border-radius:var(--radius-m)">
      <${CatIcon} category=${guessTop || guessCat} />
      <span class="row-main"><b>${parsed.description}</b><span>${guessCat ? guessCat.name + ' · כמו בפעם הקודמת' : 'בלי קטגוריה · אפשר לבחור אחר כך'} · היום</span></span>
      <span class="amt num">${money(parsed.amount)}</span>
    </div>`}
    <button type="button" class="btn" disabled=${!parsed || busy} onClick=${fromText}>${busy ? 'מוסיף…' : 'להוסיף'}</button>
    ${quick.length > 0 && html`<div style="display:flex;flex-direction:column;gap:8px">
      <b style="font-size:13px;color:var(--muted)">בלחיצה אחת · מה שאתם קונים הכי הרבה</b>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
        ${quick.map((q) => html`<button type="button" class="chip" style="height:48px;justify-content:space-between;border-radius:14px" disabled=${busy}
            onClick=${() => save({ type: 'expense', amount: q.amount, description: q.description, category_id: q.category_id, subcategory_id: q.subcategory_id })}>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${q.description}</span><b class="num">${money(q.amount)}</b>
        </button>`)}
      </div>
    </div>`}
    ${onImport && html`<button type="button" class="btn-text" style="color:var(--accent);display:flex;align-items:center;justify-content:center;gap:6px" onClick=${onImport}>
      <${Icon} name="upload" size=${17} />או: העלאת פירוט חודשי של כרטיס</button>`}
  <//>`;
}
