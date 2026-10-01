import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { CatIcon } from '../../components/CatIcon.js';
import { Segmented } from '../../components/Segmented.js';
import { parseQuickAdd, guessCategory, frequentMerchants } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { addTransaction, deleteNow } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// Free text ("46 קפה בארומה"), Enter adds. The category is taken from the
// last time this merchant appeared. One-tap buttons for what the household
// buys most often.
export function AddSheet({ data, onClose }) {
  const [text, setText] = useState('');
  const [type, setType] = useState('expense');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const parsed = parseQuickAdd(text);
  const guess = parsed ? guessCategory(parsed.description, data.txs.filter((t) => (t.type === 'income') === (type === 'income'))) : null;
  const guessCat = guess ? byId.get(guess.subcategory_id) || byId.get(guess.category_id) : null;
  const guessTop = guess ? byId.get(guess.category_id) : null;
  const quick = type === 'expense' ? frequentMerchants(data.txs, new Date()) : [];

  const save = async (item) => {
    if (busy || !item) return;
    setBusy(true);
    try {
      const row = await addTransaction({ type, ...item });
      onClose();
      showToast('נוסף: ' + row.description + ' ' + money(row.amount), {
        undo: () => deleteNow(row.id).catch(() => showToast('הביטול נכשל. אפשר למחוק את התנועה מהרשימה.'))
      });
    } catch (_err) {
      setBusy(false);
      showToast('ההוספה נכשלה. נסו שוב.');
    }
  };
  const fromText = () => parsed && save({ amount: parsed.amount, description: parsed.description, category_id: guess ? guess.category_id : null, subcategory_id: guess ? guess.subcategory_id : null });

  return html`<${Sheet} title=${type === 'income' ? 'הוספת הכנסה' : 'הוספת הוצאה'} onClose=${onClose}>
    <${Segmented} label="סוג" value=${type} onChange=${setType} options=${[{ key: 'expense', label: 'הוצאה' }, { key: 'income', label: 'הכנסה' }]} />
    <label class="field"><span>סכום ומה ${type === 'income' ? 'נכנס' : 'קניתם'}, בכל סדר</span>
      <input ref=${inputRef} class="input" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') fromText(); }}
        placeholder=${type === 'income' ? 'למשל: 500 החזר מביטוח לאומי' : 'למשל: 46 קפה בארומה'} enterkeyhint="done" />
    </label>
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
            onClick=${() => save({ amount: q.amount, description: q.description, category_id: q.category_id, subcategory_id: q.subcategory_id })}>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${q.description}</span><b class="num">${money(q.amount)}</b>
        </button>`)}
      </div>
    </div>`}
  <//>`;
}
