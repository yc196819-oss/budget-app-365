import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Segmented } from '../../components/Segmented.js';
import { saveProperty, deleteProperty } from '../../data/property.js';
import { COSTS, rentCandidates } from '../../domain/property.js';
import { money } from '../../domain/format.js';
import { showToast } from '../../lib/toast.js';

const str = (v) => (v === null || v === undefined ? '' : String(v));
const has = (v) => String(v || '').replace(/[,₪%\s]/g, '') !== '';

// An apartment and its mortgage: an apartment for rent (or standing empty),
// or the family's own home, whose mortgage counts too.
export function PropertySheet({ property, txs, onClose }) {
  const p = property || {};
  const m = p.mortgage || {};
  const [kind, setKind] = useState(p.home ? 'home' : 'invest');
  const [name, setName] = useState(str(p.name));
  const [city, setCity] = useState(str(p.city));
  const [value, setValue] = useState(str(p.value));
  const [rented, setRented] = useState(property ? !!p.rented : true);
  const [rent, setRent] = useState(str(p.rent));
  const [payer, setPayer] = useState(str(p.rent_payer));
  const [costs, setCosts] = useState(() => Object.fromEntries(COSTS.map((c) => [c.key, str(p.costs && p.costs[c.key])])));
  const [hasLoan, setHasLoan] = useState(property ? !!p.mortgage : true);
  const [balance, setBalance] = useState(str(m.balance));
  const [rate, setRate] = useState(str(m.rate));
  const [payment, setPayment] = useState(str(m.payment));
  const [months, setMonths] = useState(str(m.months));
  const [busy, setBusy] = useState(false);
  const home = kind === 'home';
  // The rent coming in, as the account shows it (the same payer, month after month).
  const found = !home && rented ? rentCandidates(txs || []).slice(0, 3) : [];

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveProperty(property ? property.id : null, {
        name: name || (home ? 'הבית שלנו' : 'הדירה'), city, home, rented: !home && rented,
        value, rent: !home && rented ? rent : null, rent_payer: !home && rented ? payer : null, costs,
        mortgage: hasLoan ? { balance, rate, payment, months: has(payment) ? null : months } : null
      });
      onClose();
      showToast(property ? 'עודכן' : 'נוסף');
    } catch (_err) {
      setBusy(false);
      showToast('השמירה נכשלה. נסו שוב.');
    }
  };
  const remove = async () => {
    try { await deleteProperty(property.id); onClose(); showToast('נמחק'); } catch (_err) { showToast('המחיקה נכשלה. נסו שוב.'); }
  };
  const loanOk = !hasLoan || (has(balance) && (has(payment) || has(months)));

  return html`<${Sheet} title=${property ? p.name || 'הדירה' : 'דירה או משכנתא'} onClose=${onClose} full>
    <form class="stack prop-form" onSubmit=${save}>
      <${Segmented} label="סוג" value=${kind} onChange=${setKind} options=${[{ key: 'invest', label: 'דירה נוספת' }, { key: 'home', label: 'הבית שלנו' }]} />
      <label class="field"><span>שם</span><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder=${home ? 'הבית שלנו' : 'למשל: הדירה בבית שמש'} maxlength="60" /></label>
      <label class="field"><span>עיר (לא חובה)</span><input class="input" value=${city} onInput=${(e) => setCity(e.target.value)} maxlength="60" /></label>
      <label class="field"><span>שווי הדירה בערך (₪)</span><input class="input num" inputmode="decimal" value=${value} onInput=${(e) => setValue(e.target.value)} placeholder="למשל: 1,650,000" /></label>

      ${!home && html`<fieldset class="prop-group">
        <legend>שכירות</legend>
        <${Segmented} label="מושכרת" value=${rented ? 'yes' : 'no'} onChange=${(v) => setRented(v === 'yes')} options=${[{ key: 'yes', label: 'מושכרת' }, { key: 'no', label: 'עומדת ריקה' }]} />
        ${rented && html`<label class="field"><span>שכר דירה בחודש (₪)</span><input class="input num" inputmode="decimal" value=${rent} onInput=${(e) => setRent(e.target.value)} placeholder="למשל: 5,200" /></label>
          ${found.length > 0 && html`<div class="prop-found" role="group" aria-label="הכנסות קבועות מהחשבון">
            <span class="muted">בחשבון יש הכנסה קבועה. זו השכירות?</span>
            ${found.map((f) => html`<button type="button" class=${'chip' + (payer === f.who ? ' on' : '')} aria-pressed=${payer === f.who} onClick=${() => { setRent(String(f.amount)); setPayer(f.who); }}>
              ${money(f.amount)} · ${f.who} (${f.months} חודשים)</button>`)}
          </div>`}`}
      </fieldset>`}

      <fieldset class="prop-group">
        <legend>הוצאות בחודש</legend>
        <div class="prop-costs">
          ${COSTS.map((c) => html`<label class="field" key=${c.key}><span>${c.label}</span><input class="input num" inputmode="decimal" value=${costs[c.key]} onInput=${(e) => setCosts({ ...costs, [c.key]: e.target.value })} placeholder="0" /></label>`)}
        </div>
      </fieldset>

      <fieldset class="prop-group">
        <legend>משכנתא</legend>
        <${Segmented} label="משכנתא" value=${hasLoan ? 'yes' : 'no'} onChange=${(v) => setHasLoan(v === 'yes')} options=${[{ key: 'yes', label: 'יש משכנתא' }, { key: 'no', label: 'אין' }]} />
        ${hasLoan && html`<label class="field"><span>כמה נשאר לשלם (₪)</span><input class="input num" inputmode="decimal" value=${balance} onInput=${(e) => setBalance(e.target.value)} placeholder="מהדוח של הבנק" /></label>
          <label class="field"><span>ריבית בשנה (%)</span><input class="input num" inputmode="decimal" value=${rate} onInput=${(e) => setRate(e.target.value)} placeholder="למשל: 4.6" /></label>
          <label class="field"><span>החזר חודשי (₪)</span><input class="input num" inputmode="decimal" value=${payment} onInput=${(e) => setPayment(e.target.value)} placeholder="למשל: 4,700" /></label>
          ${!has(payment) && html`<label class="field"><span>או: כמה חודשים נשארו</span><input class="input num" inputmode="numeric" value=${months} onInput=${(e) => setMonths(e.target.value)} placeholder="למשל: 240" /></label>`}`}
      </fieldset>

      <button type="submit" class="btn" disabled=${busy || !loanOk}>${busy ? 'שומר…' : 'שמירה'}</button>
      ${!loanOk && html`<span class="faint" style="font-size:13px">למשכנתא צריך את מה שנשאר לשלם, ואת ההחזר החודשי או מספר החודשים.</span>`}
      ${property && html`<button type="button" class="btn-text" style="color:var(--danger);align-self:flex-start" onClick=${remove}>למחוק</button>`}
    </form>
  <//>`;
}
