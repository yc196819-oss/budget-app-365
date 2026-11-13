import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { money } from '../../domain/format.js';
import { fixedCosts, findings } from '../../domain/fixedcheck.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { track } from '../../lib/telemetry.js';

// "The advisor went over the fixed costs": a dark card on home (the month's
// colours, a gold touch) when there is something worth a look, at most once
// a month once set aside; a tap opens the check: each kind with what it
// costs, and under it one insight to answer in a tap. What the household
// answered ("that's fine") is not raised again on this device.
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); };
const KIND = { cell: { icon: 'phone', tint: 'var(--fx-cell)' }, net: { icon: 'wave', tint: 'var(--fx-net)' }, subs: { icon: 'play', tint: 'var(--fx-subs)' }, ins: { icon: 'shield', tint: 'var(--fx-ins)' } };
const readList = (key) => { try { return JSON.parse(readLocal(key, '[]')); } catch (_e) { return []; } };

function useFixed(data) {
  const okKey = 'fixed:ok:' + data.hid;
  const [ok, setOkState] = useState(() => readList(okKey));
  const setOk = (id) => { const next = [...new Set([...ok, id])]; writeLocal(okKey, JSON.stringify(next)); setOkState(next); };
  const kinds = fixedCosts(data.txs, { categories: data.categories });
  const found = findings(kinds).filter((f) => !ok.includes(f.id));
  const total = kinds.reduce((s, k) => s + k.total, 0);
  return { kinds, found, total, setOk };
}

export function FixedCheckCard({ data }) {
  const key = 'fixed:later:' + data.hid;
  const [later, setLater] = useState(() => readLocal(key, '') === thisMonth());
  const [open, setOpen] = useState(false);
  const fx = useFixed(data);
  if ((!fx.found.length || later) && !open) return null;
  return html`
    ${!later && fx.found.length > 0 && html`<div class="fxc rise">
      <span class="fxc-eye"><span class="fxc-spark" aria-hidden="true"><${Icon} name="spark" size=${14} /></span>היועץ עבר על ההוצאות הקבועות</span>
      <span class="fxc-big num">${money(fx.total)} <small>בחודש</small></span>
      <span class="fxc-lead">על ${fx.kinds.map((k) => k.name).join(', ').replace(/, ([^,]*)$/, ' ו$1')} · ${money(fx.total * 12)} בשנה</span>
      <${Split} kinds=${fx.kinds} />
      <button type="button" class="fxc-hint" onClick=${() => { setOpen(true); track('fixed_open'); }}>
        <span><b>${fx.found.length === 1 ? 'דבר אחד ששווה לבדוק' : fx.found.length + ' דברים ששווה לבדוק'}</b><small>${fx.found.slice(0, 3).map((f) => f.tag).join(' · ')}</small></span>
        <span class="fxc-go">לבדיקה ‹</span></button>
      <button type="button" class="fxc-later" onClick=${() => { writeLocal(key, thisMonth()); setLater(true); }}>לא עכשיו</button>
    </div>`}
    ${open && html`<${FixedSheet} fx=${fx} onClose=${() => setOpen(false)} />`}`;
}

// How the month's fixed costs split between the kinds: a bar and a legend.
function Split({ kinds }) {
  return html`<span class="fxc-seg" aria-hidden="true">${kinds.map((k) => html`<i key=${k.key} style=${'flex:' + Math.max(1, k.total) + ';background:' + KIND[k.key].tint}></i>`)}</span>
    <span class="fxc-legend">${kinds.map((k) => html`<span key=${k.key}><i style=${'background:' + KIND[k.key].tint}></i>${k.name} <b class="num">${money(k.total)}</b></span>`)}</span>`;
}

export function FixedSheet({ fx, onClose }) {
  const ups = fx.found.filter((f) => f.type === 'up').length;
  const answer = (f) => { fx.setOk(f.id); track('fixed_ok'); };
  return html`<${Sheet} title="בדיקת הוצאות קבועות" onClose=${onClose}>
    <div class="fx">
      <div class="fx-top">
        <span class="fxc-big num">${money(fx.total)} <small>בחודש</small></span>
        <span class="fx-kpis"><span><small>בשנה</small><b class="num">${money(fx.total * 12)}</b></span><span><small>שווה לבדוק</small><b class="num">${fx.found.length}</b></span><span><small>עלו לאחרונה</small><b class="num">${ups}</b></span></span>
        <span class="fx-src">לפי הפירוטים של 4 החודשים האחרונים</span>
      </div>
      ${fx.kinds.map((k) => html`<div class="fx-kind" key=${k.key}>
        <div class="fx-kh"><span class="fx-ic" style=${'background:' + KIND[k.key].tint} aria-hidden="true"><${Icon} name=${KIND[k.key].icon} size=${20} /></span>
          <span class="fx-kn"><b>${k.name}</b><small>${k.items.length === 1 ? k.items[0].name : k.items.length + ' חיובים קבועים'}</small></span><b class="num fx-amt">${money(k.total)}</b></div>
        ${k.items.length > 1 && html`<div class="fx-items">${k.items.map((i, n) => html`<div key=${n}><span>${i.name}</span><span class="num">${i.before && i.monthly > i.before ? html`<s>${money(i.before)}</s>` : ''}${money(i.monthly)}</span></div>`)}</div>`}
        ${fx.found.filter((f) => f.kind === k.key).map((f) => html`<div class="fx-ins" key=${f.id}>
          <span class="fx-tag">${f.tag}</span><p>${f.text}</p>
          <span class="fx-acts">
            ${f.link && html`<a class="fx-pri" href=${f.link.url} target="_blank" rel="noopener noreferrer" onClick=${() => track('fixed_link')}>${f.link.label} ↗</a>`}
            <button type="button" class=${f.link ? 'fx-sec' : 'fx-pri'} onClick=${() => answer(f)}>${f.yes || 'זה בסדר'}</button>
          </span></div>`)}
      </div>`)}
      ${!fx.found.length && html`<p class="fx-done"><${Icon} name="check" size=${18} />עברתם על הכל. נבדוק שוב כשמשהו ישתנה.</p>`}
      <p class="fx-trust"><${Icon} name="lock" size=${14} />אנחנו לא מוכרים ביטוחים או חבילות ולא מקבלים עמלה</p>
    </div>
  <//>`;
}
