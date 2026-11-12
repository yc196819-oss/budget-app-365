import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { money } from '../../domain/format.js';
import { fixedCosts, findings } from '../../domain/fixedcheck.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { track } from '../../lib/telemetry.js';

// "The advisor checked the fixed costs": a card on home when there is
// something worth a look (a price that went up, two streaming services…),
// at most once a month once set aside; a tap opens the check itself: each
// kind, what it costs, and what to do.
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); };

export function FixedCheckCard({ data }) {
  const key = 'fixed:later:' + data.hid;
  const [later, setLater] = useState(() => readLocal(key, '') === thisMonth());
  const [open, setOpen] = useState(false);
  const kinds = fixedCosts(data.txs, { categories: data.categories });
  const found = findings(kinds);
  if (!found.length || (later && !open)) return null;
  const total = kinds.reduce((s, k) => s + k.total, 0);
  const names = kinds.map((k) => k.name).join(', ').replace(/, ([^,]*)$/, ' ו$1');
  return html`
    ${!later && html`<div class="card fx-card rise">
      <span class="fx-eyebrow"><span class="fx-spark" aria-hidden="true"><${Icon} name="spark" size=${15} /></span>היועץ בדק את ההוצאות הקבועות</span>
      <b class="fx-title">${money(total)} בחודש על ${names}</b>
      <span class="muted fx-sub">${found.length === 1 ? 'מצאנו דבר אחד ששווה לבדוק.' : 'מצאנו ' + found.length + ' דברים ששווה לבדוק.'}</span>
      <span class="fx-chips">${found.slice(0, 3).map((f, i) => html`<span key=${i} class="fx-chip">${f.chip}</span>`)}</span>
      <span class="fx-acts"><button type="button" class="btn-text fx-open" onClick=${() => { setOpen(true); track('fixed_open'); }}>לראות את הבדיקה ›</button>
        <button type="button" class="btn-text faint" onClick=${() => { writeLocal(key, thisMonth()); setLater(true); }}>לא עכשיו</button></span>
    </div>`}
    ${open && html`<${FixedSheet} kinds=${kinds} found=${found} total=${total} onClose=${() => setOpen(false)} />`}`;
}

export function FixedSheet({ kinds, found, total, onClose }) {
  return html`<${Sheet} title="בדיקת הוצאות קבועות" onClose=${onClose}>
    <div class="stack fx">
      <p class="muted fx-intro">${money(total)} בחודש · לפי הפירוטים של 4 החודשים האחרונים</p>
      ${kinds.map((k) => html`<div class="card fx-kind" key=${k.key}>
        <div class="fx-head"><b>${k.name}</b><b class="num">${money(k.total)}</b></div>
        ${k.items.map((i, n) => html`<div class="fx-row" key=${n}><span>${i.name}</span><span class="num">${i.before && i.monthly > i.before ? html`<s class="faint">${money(i.before)}</s> ` : ''}${money(i.monthly)}</span></div>`)}
        ${found.filter((f) => f.kind === k.key).map((f, n) => html`<div class="fx-note" key=${n}>${f.text}
          ${f.link && html`<a class="btn btn-ghost fx-link" href=${f.link.url} target="_blank" rel="noopener noreferrer">${f.link.label} ↗</a>`}</div>`)}
      </div>`)}
      <p class="faint tr-note">אנחנו לא מוכרים ביטוחים או חבילות ולא מקבלים עמלה. זו רק בדיקה של מה שכבר יורד מכם.</p>
    </div>
  <//>`;
}
