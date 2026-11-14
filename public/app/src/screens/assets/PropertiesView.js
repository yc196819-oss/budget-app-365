import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { money } from '../../domain/format.js';
import { propertyView, prepay, accountFlows, withAccount, RENT_EXEMPT_ABOUT } from '../../domain/property.js';
import { Loading } from '../../components/Loading.js';

const signed = (v) => (v < 0 ? '−' : '') + money(Math.abs(v));
const monthYear = (ym) => (ym ? ym.slice(5, 7) + '/' + ym.slice(0, 4) : '');
const yearsText = (months) => {
  const y = Math.floor(months / 12), m = months % 12;
  if (!y) return m + ' חודשים';
  return (y === 1 ? 'שנה' : y === 2 ? 'שנתיים' : y + ' שנים') + (m ? ' ו-' + m + ' חודשים' : '');
};
const pct = (v) => (v == null ? '—' : v.toFixed(1) + '%');

// The family's apartments and mortgages: what each brings in and costs, what
// is left in the pocket, and when the mortgage ends.
export function PropertiesView({ props, today, onOpen, txs = [], accounts = [] }) {
  if (props.status === 'loading' || props.status === 'idle') return html`<${Loading} label="טוען…" />`;
  if (props.missing) {
    return html`<div class="card muted" role="status" style="font-size:14px">החלק של הדירות עוד לא הופעל במסד הנתונים (supabase_properties.sql).</div>`;
  }
  const list = props.list;
  return html`<div class="stack">
    <div class="sec-row"><h2 class="section-h">דירות ומשכנתאות</h2><button type="button" class="btn-text" onClick=${() => onOpen('property')}>+ דירה</button></div>
    ${list.length === 0
      ? html`<div class="card muted" style="font-size:14px">הוסיפו דירה נוספת שיש לכם, או את הבית שלכם עם המשכנתא, כדי לראות כמה נשאר בכיס כל חודש ומתי המשכנתא נגמרת.</div>`
      : list.map((p) => html`<${PropertyCard} key=${p.id} p=${p} today=${today} txs=${txs} accounts=${accounts} onEdit=${() => onOpen('property', p.id)} />`)}
    <span class="faint" style="font-size:12px">החישוב הוא לפי החזר קבוע (שפיצר) וריבית אחת. במשכנתא עם כמה מסלולים או הצמדה למדד, המספרים בקירוב. זה לא ייעוץ מס או השקעות.</span>
  </div>`;
}

// What the hero shows on the apartments view.
// The apartment as it is counted: from its own account when it has one with lines.
const counted = (p, txs, today) => (p.home || !p.account_id ? p : withAccount(p, accountFlows(txs, p.account_id, { today })));

export function propertiesTotals(list, today, txs = []) {
  let equity = 0, cash = 0, owed = 0;
  for (const p of list || []) { const v = propertyView(counted(p, txs, today), today); equity += v.equity; if (!p.home) cash += v.cashMonth; owed += v.mortgage ? v.mortgage.balance : 0; }
  return { equity, cash, owed };
}

function PropertyCard({ p, today, txs, accounts, onEdit }) {
  const flows = !p.home && p.account_id ? accountFlows(txs, p.account_id, { today }) : null;
  const v = propertyView(counted(p, txs, today), today);
  const acct = p.account_id ? accounts.find((a) => a.id === p.account_id) : null;
  const m = v.mortgage;
  const title = p.name || (p.home ? 'הבית שלנו' : 'הדירה');
  return html`<section class="card prop-card stack" aria-label=${title}>
    <div class="sec-row">
      <div class="stack" style="gap:2px"><b class="prop-title">${title}</b>
        <span class="muted" style="font-size:13px">${[p.city, p.home ? 'הבית שלנו' : p.rented ? 'מושכרת' : 'עומדת ריקה'].filter(Boolean).join(' · ')}</span></div>
      <button type="button" class="btn-text" onClick=${onEdit} aria-label=${'עריכה: ' + title}>עריכה</button>
    </div>
    <div class="prop-boxes">
      <div><small>שווי</small><b class="num">${v.value ? money(v.value) : '—'}</b></div>
      <div><small>${m ? 'שלכם (בלי המשכנתא)' : 'שלכם'}</small><b class="num">${v.value ? money(v.equity) : '—'}</b></div>
    </div>

    ${flows && html`<span class="muted prop-from" style="font-size:13px">${flows.months
      ? 'לפי ' + (acct ? acct.name : 'החשבון של הדירה') + ': ממוצע של ' + flows.months + ' החודשים האחרונים'
      : 'עוד אין תנועות ב' + (acct ? acct.name : 'חשבון של הדירה') + '. החישוב לפי מה שהוקלד.'}</span>`}
    <dl class="prop-lines">
      ${!p.home && (p.rented || (flows && flows.months)) && html`<div><dt>שכירות נכנסת</dt><dd class="num" style="color:var(--income)">+${money(v.rent)}</dd></div>`}
      ${v.costs > 0 && html`<div><dt>${flows && flows.months ? 'הוצאות בחשבון (בלי המשכנתא)' : "הוצאות (ארנונה, ועד וכו')"}</dt><dd class="num">−${money(v.costs)}</dd></div>`}
      ${m && html`<div><dt>החזר משכנתא</dt><dd class="num">−${money(m.payment)}</dd></div>`}
      <div class="prop-total"><dt>${p.home ? 'עולה לכם בחודש' : 'נשאר בכיס בחודש'}</dt><dd class="num" style=${v.cashMonth < 0 && !p.home ? 'color:var(--danger)' : ''}>${p.home ? money(-v.cashMonth) : signed(v.cashMonth)}</dd></div>
      ${!p.home && html`<div><dt>בשנה</dt><dd class="num">${signed(v.cashYear)}</dd></div>`}
    </dl>

    ${!p.home && p.rented && v.value > 0 && html`<div class="prop-yield muted">
      תשואה: <b class="num">${pct(v.grossYield)}</b> לפני הוצאות, <b class="num">${pct(v.netYield)}</b> אחריהן (בלי המשכנתא).
      ${m && !m.growing && v.cashMonth < 0 && v.profitMonth > 0 ? html` מהמשכנתא, ${money(m.split.principal)} בחודש הולכים לקרן ונשארים שלכם: בלי הריבית, הדירה מכניסה ${money(v.profitMonth)} בחודש.` : ''}
    </div>`}

    ${v.rentTax && html`<div class="prop-note" role="note">
      ${v.rentTax === 'over'
        ? 'שכר הדירה מעל תקרת הפטור ממס על שכירות למגורים (בערך ' + money(RENT_EXEMPT_ABOUT) + ' בחודש). יש כמה מסלולי מס, וכדאי לבדוק עם רואה חשבון מה מתאים לכם.'
        : 'שכר הדירה קרוב לתקרת הפטור ממס על שכירות למגורים (בערך ' + money(RENT_EXEMPT_ABOUT) + ' בחודש). שווה לשים לב כשמעלים את השכירות.'}
    </div>`}

    ${m && html`<${MortgageBlock} m=${m} />`}
  </section>`;
}

function MortgageBlock({ m }) {
  const [sum, setSum] = useState('');
  const [open, setOpen] = useState(false);
  const n = Number(String(sum).replace(/[,₪\s]/g, ''));
  const what = open && n > 0 && !m.growing ? prepay(m.balance, m.rate, m.payment, n) : null;
  const share = m.payment > 0 ? Math.round((Math.min(m.split.interest, m.payment) / m.payment) * 100) : 0;
  return html`<div class="prop-mortgage stack">
    <b>המשכנתא</b>
    <dl class="prop-lines">
      <div><dt>נשאר לשלם</dt><dd class="num">${money(m.balance)}</dd></div>
      <div><dt>ריבית</dt><dd class="num">${m.rate ? m.rate + '%' : '—'}</dd></div>
      ${!m.growing && html`<div><dt>נגמרת</dt><dd class="num">${monthYear(m.ends)} (עוד ${yearsText(m.months)})</dd></div>
        <div><dt>ריבית שעוד תשולם</dt><dd class="num">${money(m.interestLeft)}</dd></div>`}
    </dl>
    ${m.growing
      ? html`<div class="prop-note" role="alert">ההחזר (${money(m.payment)}) לא מכסה אפילו את הריבית (${money(m.split.interest)} בחודש), אז החוב גדל. כדאי לבדוק את המספרים מול הבנק.</div>`
      : html`<div class="stack" style="gap:4px">
          <span class="muted" style="font-size:13px">מההחזר החודשי: ${money(m.split.interest)} ריבית, ${money(m.split.principal)} מקטינים את החוב</span>
          <span class="bar prop-split" role="img" aria-label=${share + '% מההחזר הולכים לריבית'}><span style=${'width:' + share + '%'}></span></span>
        </div>`}
    ${!m.growing && html`<details class="prop-prepay" open=${open} onToggle=${(e) => setOpen(e.currentTarget.open)}>
      <summary>מה אם נחזיר סכום עכשיו?</summary>
      <label class="field"><span>סכום להחזיר (₪)</span><input class="input num" inputmode="decimal" value=${sum} onInput=${(e) => setSum(e.target.value)} placeholder="למשל: 100,000" /></label>
      ${what && html`<div class="prop-options" aria-live="polite">
        <div class="card"><b>לקצר את התקופה</b><span>אותו החזר, נגמרת ${what.shorter.monthsSaved > 0 ? yearsText(what.shorter.monthsSaved) + ' מוקדם יותר' : 'כמעט באותו זמן'}</span><span>חוסכים בערך <b class="num">${money(what.shorter.interestSaved)}</b> ריבית</span></div>
        <div class="card"><b>להקטין את ההחזר</b><span>אותו סוף, ההחזר יורד ב-<b class="num">${money(what.lower.paymentDrop)}</b> בחודש</span><span>חוסכים בערך <b class="num">${money(what.lower.interestSaved)}</b> ריבית</span></div>
        <span class="faint" style="font-size:12px">הבנק עשוי לגבות עמלת פירעון מוקדם. כדאי לבקש ממנו את הסכום המדויק לפני.</span>
      </div>`}
    </details>`}
  </div>`;
}
