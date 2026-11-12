import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { refundCandidates, asRefund, fromRefund, investAfter } from '../../domain/moves.js';
import { updateTx, markTransfer, keepBoth, saveRow } from '../../data/household.js';
import { investmentValue } from '../../domain/assets.js';
import { showToast } from '../../lib/toast.js';
import { track } from '../../lib/telemetry.js';

// One line, one question: money in from Bit (a refund of an expense,
// income, or the household's own money), or money to or from an investment
// (a withdrawal or deposit, or a gain or ordinary expense). Nothing changes
// until the household chooses and saves.
const dm = (iso) => String(iso || '').slice(5, 10).split('-').reverse().map(Number).join('.');

export function MoveSheet({ data, line, kind, onClose }) {
  const income = line.type === 'income';
  const choices = kind === 'bit'
    ? [{ key: 'refund', title: 'החזר על הוצאה', sub: 'מישהו החזיר לכם חלק ממשהו ששילמתם' },
       { key: 'income', title: 'הכנסה', sub: 'מכרתם משהו, או קיבלתם תשלום על עבודה' },
       { key: 'own', title: 'כסף שלי מביט', sub: 'משכתם יתרה שלכם: לא הוצאה ולא הכנסה' }]
    : income
      ? [{ key: 'move', title: 'משיכה מההשקעה', sub: 'הכסף שלכם עבר מההשקעה לבנק: לא הכנסה' },
         { key: 'income', title: 'רווח או דיבידנד', sub: 'נשאר הכנסה, ושווי ההשקעה לא משתנה' }]
      : [{ key: 'move', title: 'הפקדה להשקעה', sub: 'הכסף עבר מהבנק להשקעה: לא הוצאה' },
         { key: 'income', title: 'הוצאה רגילה', sub: 'נשאר הוצאה, כמו שהוא' }];
  const [pick, setPick] = useState(choices[0].key);
  const cands = kind === 'bit' ? refundCandidates(data.txs, line) : [];
  const [exp, setExp] = useState(cands[0] ? cands[0].id : '');
  const invs = data.investments || [];
  const [inv, setInv] = useState(invs.length === 1 ? invs[0].id : '');
  const [busy, setBusy] = useState(false);
  const amount = Math.abs(Number(line.amount) || 0);
  const cat = (t) => { const c = (data.categories || []).find((x) => x.id === (t.subcategory_id || t.category_id)); return c ? c.name : ''; };
  const value = (i) => investmentValue(i, null).value;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (pick === 'income') {
        await keepBoth('a:' + line.id);
        showToast(kind === 'bit' ? 'בסדר, נשאר הכנסה.' : income ? 'בסדר, נשאר הכנסה.' : 'בסדר, נשאר הוצאה.');
      } else if (pick === 'refund') {
        const e = cands.find((t) => t.id === exp);
        if (!e) { showToast('בחרו על איזו הוצאה זה החזר.'); setBusy(false); return; }
        await updateTx(line.id, asRefund(line, e));
        showToast('נשמר כהחזר על ' + e.description + '. ההוצאה נספרת עכשיו ' + money(Math.max(0, Number(e.amount) - amount)) + '.', { undo: () => updateTx(line.id, fromRefund(line)).catch(() => showToast('לא הצלחנו לבטל. נסו שוב.')) });
      } else if (pick === 'own') {
        await markTransfer([line.id], true);
        showToast('סומן ככסף שלכם מביט: לא נספר כהכנסה.', { undo: () => markTransfer([line.id], false).catch(() => {}) });
      } else {
        await markTransfer([line.id], true);
        const i = invs.find((x) => x.id === inv);
        const patch = investAfter(i, amount, income ? 'out' : 'in');
        if (patch) await saveRow('investments', patch);
        showToast((income ? 'נשמר כמשיכה מההשקעה: לא נספר כהכנסה.' : 'נשמר כהפקדה להשקעה: לא נספר כהוצאה.')
          + (patch ? ' שווי ' + i.name + ': ' + money(patch.current_value) + '.' : i ? ' השווי של ' + i.name + ' מתעדכן מהבורסה: עדכנו את מספר היחידות בנכסים.' : ''));
      }
      track('move_' + kind + '_' + pick);
      onClose();
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); setBusy(false); }
  };

  return html`<${Sheet} title=${(kind === 'bit' ? money(amount) + ' מביט' : money(amount) + (income ? ' מהשקעה' : ' להשקעה'))} onClose=${onClose}>
    <div class="stack mv">
      <div class=${'mv-line ' + (income ? 'in' : 'out')}><span class="tr-arrow" aria-hidden="true">${income ? '+' : '−'}</span>
        <span class="tr-what"><b>${line.description}</b><small>${dm(line.tx_date)}</small></span><b class="num">${(income ? '+' : '−') + money(amount)}</b></div>
      <b class="mv-q">מה זה היה?</b>
      <div class="mv-opts" role="radiogroup" aria-label="מה זה היה?">
        ${choices.map((c) => html`<div key=${c.key} class=${'mv-opt' + (pick === c.key ? ' on' : '')}>
          <button type="button" role="radio" aria-checked=${String(pick === c.key)} class="mv-pick" onClick=${() => setPick(c.key)}>
            <span class="mv-r" aria-hidden="true"></span><span><b>${c.title}</b><small>${c.sub}</small></span></button>
          ${pick === c.key && c.key === 'refund' && html`<div class="mv-sub">
            ${cands.length ? cands.map((t) => html`<button type="button" key=${t.id} class=${'mv-item' + (exp === t.id ? ' on' : '')} aria-pressed=${String(exp === t.id)} onClick=${() => setExp(t.id)}><span>${t.description} · ${dm(t.tx_date)}${cat(t) ? html` <small>${cat(t)}</small>` : ''}</span><b class="num">${money(t.amount)}</b></button>`)
              : html`<small class="muted">לא מצאנו הוצאה מתאימה ב-45 הימים שלפני. אפשר לבחור "הכנסה".</small>`}
            ${exp && html`<small class="muted">ההוצאה תיספר ${money(Math.max(0, Number((cands.find((t) => t.id === exp) || {}).amount) - amount))} ולא ${money((cands.find((t) => t.id === exp) || {}).amount)}</small>`}
          </div>`}
          ${pick === c.key && c.key === 'move' && invs.length > 0 && html`<div class="mv-sub">
            ${invs.map((i) => html`<button type="button" key=${i.id} class=${'mv-item' + (inv === i.id ? ' on' : '')} aria-pressed=${String(inv === i.id)} onClick=${() => setInv(inv === i.id ? '' : i.id)}><span>${i.name}</span><b class="num">${money(value(i))}</b></button>`)}
            <small class="muted">${inv ? (income ? 'נוריד ' : 'נוסיף ') + money(amount) + (income ? ' משווי ההשקעה' : ' לשווי ההשקעה') : 'אפשר גם לא לבחור: רק לא ייספר כ' + (income ? 'הכנסה' : 'הוצאה')}</small>
          </div>`}
        </div>`)}
      </div>
      <button type="button" class="btn" disabled=${busy} onClick=${save}>לשמור</button>
      <p class="faint tr-note">אפשר לבטל בכל רגע מפרטי התנועה.</p>
    </div>
  <//>`;
}
