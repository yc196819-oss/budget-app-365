import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { listRows, whenText, cleanName, compareFirst } from '../../domain/shopLists.js';
import { money } from '../../domain/format.js';

const KIND_ICON = { shabbat: 'spark', holiday: 'spark', guests: 'together', recipe: 'book', pharm: 'drop' };

// "הרשימות שלי": every open list in a row, like chats, the latest first, and
// the shopping trips that ended below. A tap opens a list.
export function ShopLists({ lists, items, trips, onOpen, onCreate, onAdvisor, onTrips, onCompare = null }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const rows = listRows(lists, items);
  const submit = (e) => { e.preventDefault(); const n = cleanName(name); if (!n) return; onCreate(n); setAdding(false); setName(''); };
  const first = onCompare ? compareFirst(rows) : null;
  return html`<section class="shop-lists stack" aria-labelledby="lists-h">
    ${first && html`<button type="button" class="card sl-compare" onClick=${() => onCompare(first.id)}>
      <span class="sl-compare-ic" aria-hidden="true"><${Icon} name="cart" size=${22} /></span>
      <span class="sl-mid"><small>השוואת מחירים</small><b>כמה "${first.name}" תעלה?</b><small>${first.left === 1 ? 'מוצר אחד' : first.left + ' מוצרים'}: בכל רשת, בחנות ובאונליין עם המשלוח</small></span>
      <span class="sl-compare-go">להשוות ‹</span>
    </button>`}
    <h2 id="lists-h" class="section-h">הרשימות שלי</h2>
    ${adding ? html`<form class="sl-new-form" onSubmit=${submit}>
        <input class="input" id="sl-name" value=${name} onInput=${(e) => setName(e.currentTarget.value)} maxLength="60" placeholder="שם הרשימה, למשל: לשבת" aria-label="שם הרשימה החדשה" autoFocus />
        <button type="submit" class="btn" disabled=${!cleanName(name)}>ליצור</button>
        <button type="button" class="btn btn-ghost" onClick=${() => setAdding(false)}>ביטול</button></form>`
      : html`<div class="sl-new-row">
        <button type="button" class="sl-new" onClick=${() => setAdding(true)}><i aria-hidden="true">+</i>רשימה חדשה</button>
        ${onAdvisor && html`<button type="button" class="sl-new sl-adv" onClick=${onAdvisor}><span aria-hidden="true"><${Icon} name="spark" size=${17} /></span>היועץ מכין רשימה</button>`}
      </div>`}
    ${rows.length ? html`<div class="card sl-chats">${rows.map((l) => html`<button type="button" class="sl-chat" key=${l.id} onClick=${() => onOpen(l.id)}>
        <span class="sl-av" aria-hidden="true"><${Icon} name=${KIND_ICON[l.kind] || 'cart'} size=${21} /></span>
        <span class="sl-mid"><b>${l.name}</b><small>${l.count ? (l.preview.length ? l.preview.join(', ') + (l.more ? ' ועוד ' + l.more : '') : 'הכול נקנה') : 'ריקה. לוחצים כדי להוסיף'}</small></span>
        <span class="sl-end"><span>${whenText(l.last)}</span>${l.count ? html`<span class="sl-pg" aria-hidden="true"><i style=${'width:' + Math.round((l.done / l.count) * 100) + '%'}></i></span><span class="num">${l.done} מתוך ${l.count}</span>` : ''}</span>
      </button>`)}</div>`
      : html`<div class="card empty"><span>עוד אין רשימות. "רשימה חדשה" פותחת אחת, או שהיועץ מכין אחת לפי מה שאתם קונים.</span></div>`}
    ${trips && trips.length > 0 && html`<h2 class="section-h">קניות שהסתיימו</h2>
      <div class="card sl-chats">${trips.slice(0, 4).map((t) => html`<button type="button" class="sl-chat" key=${t.id} onClick=${() => onTrips(t.id)}>
        <span class="sl-av sl-done" aria-hidden="true"><${Icon} name="check" size=${20} /></span>
        <span class="sl-mid"><b>${t.chain_name || 'קנייה'} · ${whenText(t.finished_at)}</b><small class="num">${t.bought} מוצרים${t.total ? ' · ' + money(t.total) : ''}</small></span>
        <span class="sl-end"><span class=${'tag ' + (t.receipt_id ? 'tg' : 'tn')}>${t.receipt_id ? 'עם קבלה' : 'בלי קבלה'}</span></span>
      </button>`)}
      ${trips.length > 4 && html`<button type="button" class="sl-chat sl-more" onClick=${() => onTrips('')}>לכל ${trips.length} הקניות ‹</button>`}</div>`}
  </section>`;
}
