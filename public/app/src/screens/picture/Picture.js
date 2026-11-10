import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { PROVIDERS, providerOf, tracker, monthName, monthShort, howTo, howSteps, sourcesOf, nameOf } from '../../domain/sources.js';
import { listSourceFiles, saveRow, archiveCard, deleteRow } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';
import { track } from '../../lib/telemetry.js';

// "Complete the picture": the household's banks and cards (with their real
// logos), a ring for what is due now, a reminder for each missing statement
// (a card on its billing day, a bank account after the salary), and the last
// 6 months of every account and card.

const LOGO = '/app/assets/logos/';
export function Logo({ provider, name, size = 'm' }) {
  const p = providerOf(provider);
  if (!p) return html`<span class=${'logo-chip logo-' + size + ' logo-none'}>${name || '?'}</span>`;
  return html`<span class=${'logo-chip logo-' + size + (p.dark ? ' dark' : '')}><img src=${LOGO + p.logo} alt=${p.name} loading="lazy" /></span>`;
}
// The logo as a link to the provider's official site, in a new tab.
function SiteLogo({ source }) {
  const p = providerOf(source.provider);
  if (!p) return html`<${Logo} name=${source.name} />`;
  return html`<a class="logo-link" href=${p.url} target="_blank" rel="noopener noreferrer" title=${'לאתר של ' + p.name + ' (בחלון חדש)'} aria-label=${'לאתר של ' + p.name + ', נפתח בחלון חדש'}><${Logo} provider=${p.key} /></a>`;
}

export function Ring({ pct, size = 118, label }) {
  return html`<span class="pic-ring" style=${'width:' + size + 'px;height:' + size + 'px'} role="img" aria-label=${(label || '') + pct + '%'}>
    <svg viewBox="0 0 42 42" width=${size} height=${size} aria-hidden="true"><circle cx="21" cy="21" r="16" class="pic-ring-bg" /><circle cx="21" cy="21" r="16" class=${'pic-ring-fg' + (pct >= 100 ? ' full' : '')} pathLength="100" stroke-dasharray=${pct + ' 100'} /></svg>
    <b class="num">${pct}%</b></span>`;
}

// The files of each account and card (which one, which dates): loaded once.
export function useSourceFiles(hid, txsKey) {
  const [files, setFiles] = useState(null);
  useEffect(() => { listSourceFiles().then(setFiles).catch(() => setFiles([])); }, [hid, txsKey]);
  return files;
}

// What a row shows now: the month due and its status.
function statusFor(t, r) { const m = r.months.find((x) => x.key === r.due); return { key: r.due, status: m ? m.status : t.tasks.some((x) => x.source.id === r.source.id) ? 'missing' : 'ok' }; }

const STATUS = { ok: 'הועלה', partial: 'חלקי', missing: 'חסר', waiting: 'עוד לא' };

// On the home screen: the ring and what is missing, one tap to the sheet.
export function PictureCard({ data, onOpen }) {
  const files = useSourceFiles(data.hid, data.txs.length);
  if (files === null) return null;
  const t = tracker({ accounts: data.accounts, cards: data.cards, imports: files, txs: data.txs });
  if (!t.sources.length) {
    return html`<button type="button" class="card pic-card pic-start" onClick=${onOpen}>
      <span class="pic-logos" aria-hidden="true">${['leumi', 'hapoalim', 'max', 'cal'].map((k) => html`<${Logo} key=${k} provider=${k} size="s" />`)}</span>
      <span><b>איפה הכסף שלכם?</b><small class="muted">בחרו את הבנקים והכרטיסים שלכם, ונזכיר לכם בכל חודש להעלות את מה שחסר.</small></span><span aria-hidden="true">‹</span></button>`;
  }
  const missing = t.tasks.length;
  return html`<button type="button" class=${'card pic-card' + (missing ? '' : ' is-full')} onClick=${onOpen}>
    <${Ring} pct=${t.ring.pct} size=${64} label="הפירוטים של החודש: " />
    <span><b>${missing ? (missing === 1 ? 'חסר פירוט אחד' : 'חסרים ' + missing + ' פירוטים') : 'כל הפירוטים הועלו'}</b>
      <small class="muted">${missing ? t.tasks[0].title : t.streak > 1 ? t.streak + ' חודשים ברצף עם תמונה מלאה' : 'התמונה של החודש מלאה ומדויקת'}</small>
      <span class="pic-card-logos" aria-hidden="true">${t.rows.filter((r) => r.source.provider).slice(0, 5).map((r) => html`<span key=${r.source.id} class=${'pic-card-logo' + (t.tasks.some((x) => x.source.id === r.source.id) ? '' : ' done')}><${Logo} provider=${r.source.provider} size="s" /></span>`)}</span></span>
    <span aria-hidden="true">‹</span></button>`;
}

// Choosing the banks (step 1) and the card companies (step 2): a tile for
// each company, how many accounts or cards there are, and the days the
// reminders need. The cards a bank itself issued are counted apart: their
// statement is on the bank's site.
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
function Picker({ data, step, onStep, onDone }) {
  const kind = step === 'bank' ? 'bank' : 'card';
  const all = sourcesOf({ accounts: data.accounts, cards: data.cards });
  const of = (k, prov) => all.filter((x) => x.kind === k && x.provider === prov);
  const [busy, setBusy] = useState('');
  const banks = PROVIDERS.filter((p) => p.kind === 'bank' && of('bank', p.key).length);
  const used = (id) => data.txs.some((t) => t.account_id === id);
  const add = async (k, p) => {
    setBusy(k + p.key);
    try {
      await (k === 'card'
        ? saveRow('credit_cards', { name: nameOf({ kind: 'card', provider: p.key, name: p.name }), provider: p.key, billing_day: (of('card', p.key)[0] || {}).billingDay || 10 })
        : saveRow('bank_accounts', { name: p.name, bank_name: p.name, provider: p.key }));
      track('picture_add');
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy('');
  };
  const less = async (k, p) => {
    const list = of(k, p.key);
    if (!list.length) return;
    setBusy(k + p.key);
    try {
      if (k === 'card') await archiveCard(list[list.length - 1].id);
      else {
        // An account with transactions stays: they point at it.
        const free = [...list].reverse().find((x) => !used(x.id));
        if (free) await deleteRow('bank_accounts', free.id);
        else showToast('בחשבון הזה כבר יש תנועות, ולכן הוא נשאר ברשימה.');
      }
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy('');
  };
  const set = async (k, p, patch) => {
    try { for (const x of of(k, p.key)) await saveRow(k === 'card' ? 'credit_cards' : 'bank_accounts', { id: x.id, ...patch }); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  const tile = (p) => {
    const n = of(kind, p.key).length;
    return html`<button type="button" key=${p.key} class=${'pic-pick' + (n ? ' on' : '')} aria-pressed=${n > 0} disabled=${busy === kind + p.key}
      onClick=${() => (n === 0 ? add(kind, p) : n === 1 ? less(kind, p) : showToast('כדי להוריד אחד, לחצו על − ברשימה למטה.'))}>
      <${Logo} provider=${p.key} size="l" /><span class="sr-only">${p.name}</span>${n > 1 && html`<span class="pic-n" aria-hidden="true">${n}×</span>`}</button>`;
  };
  const day = (k, p, label, field, value, empty) => html`<label class="pic-day">${label}<select aria-label=${label + ' ' + p.name} value=${value || ''} onChange=${(e) => set(k, p, { [field]: Number(e.currentTarget.value) || null })}>${empty && html`<option value="">${empty}</option>`}${DAYS.map((d) => html`<option value=${d}>${d}</option>`)}</select>${k === 'card' ? ' בחודש' : ''}</label>`;
  const row = (k, p, title) => {
    const list = of(k, p.key);
    const n = list.length;
    return html`<li key=${k + p.key} class="pic-q">
      <${Logo} provider=${p.key} size="s" />
      <span class="pic-q-t"><b>${title || p.name}</b>
        ${k === 'card' ? day(k, p, 'החיוב ב-', 'billing_day', (list[0] || {}).billingDay || 10) : day(k, p, 'המשכורת נכנסת ב-', 'salary_day', (list[0] || {}).salaryDay, 'לא יודע')}</span>
      <span class="pic-step" role="group" aria-label=${'כמה ' + (k === 'card' ? 'כרטיסים' : 'חשבונות') + ' של ' + (title || p.name)}>
        <button type="button" aria-label="פחות" disabled=${!n || busy === k + p.key} onClick=${() => less(k, p)}>−</button><b class="num" aria-live="polite">${n}</b>
        <button type="button" aria-label="עוד אחד" disabled=${n >= 9 || busy === k + p.key} onClick=${() => add(k, p)}>+</button></span>
    </li>`;
  };
  const chosen = PROVIDERS.filter((p) => p.kind === kind && of(kind, p.key).length);
  const bankCards = banks.filter((p) => of('card', p.key).length);
  const summary = [...banks.map((p) => ['bank', p, p.name]), ...PROVIDERS.filter((p) => p.kind === 'card' && of('card', p.key).length).map((p) => ['card', p, p.name]), ...bankCards.map((p) => ['card', p, 'אשראי ' + p.name])];
  return html`<div class="pic-picker">
    <div class="pic-main">
      <span class="pic-stepno">שלב ${kind === 'bank' ? 1 : 2} מתוך 2</span>
      <h3 class="pic-title">${kind === 'bank' ? 'באיזה בנק החשבון שלכם?' : 'ואילו כרטיסי אשראי?'}</h3>
      <p class="muted pic-sub">${kind === 'bank' ? 'בוחרים פעם אחת, גם את החשבונות של בן או בת הזוג. מכאן נדע בכל חודש מה חסר, ונזכיר לכם בזמן.' : 'לחברה עם כמה כרטיסים מספיק פירוט אחד בחודש לכולם.'}</p>
      <div class="pic-grid">${PROVIDERS.filter((p) => p.kind === kind).map(tile)}</div>
      ${chosen.length > 0 && html`<ul class="pic-qs">${chosen.map((p) => row(kind, p))}</ul>`}
      ${kind === 'card' && banks.length > 0 && html`<h4 class="pic-h">כרטיסים שהבנק עצמו הנפיק</h4>
        <p class="muted pic-sub" style="margin:0 2px 4px">יש כרטיסים שהפירוט שלהם נמצא באתר של הבנק. כמה כאלה יש לכם?</p>
        <ul class="pic-qs pic-bankcards">${banks.map((p) => row('card', p, 'כרטיסים של ' + p.name))}</ul>`}
      ${kind === 'bank' && html`<p class="pic-safe"><${Icon} name="lock" size=${15} />לא נבקש מכם סיסמה. את הפירוט מורידים בעצמכם מהאתר הרשמי, ומעלים לכאן.</p>`}
    </div>
    <aside class="pic-chosen">
      <b class="pic-chosen-h">מה בחרתם</b>
      ${summary.length ? html`<ul>${summary.map(([k, p, t]) => { const n = of(k, p.key).length; return html`<li key=${k + p.key}><${Logo} provider=${p.key} size="s" /><span>${t}<small class="muted">${n === 1 ? (k === 'card' ? 'כרטיס אחד' : 'חשבון אחד') : n + (k === 'card' ? ' כרטיסים' : ' חשבונות')}</small></span></li>`; })}</ul>`
        : html`<span class="muted" style="font-size:13.5px">עוד לא נבחר כלום. לחצו על הלוגו של הבנק.</span>`}
      ${kind === 'bank' ? html`<button type="button" class="btn" onClick=${() => onStep('card')}>המשך</button>`
        : html`<button type="button" class="btn" onClick=${onDone} disabled=${!all.length}>${all.length ? 'סיימתי' : 'בחרו לפחות אחד'}</button>
          <button type="button" class="btn-text" onClick=${() => onStep('bank')}>חזרה לבנקים</button>`}
    </aside>
  </div>`;
}

export function PictureSheet({ data, onClose, onUpload }) {
  const files = useSourceFiles(data.hid, data.txs.length);
  const t = files ? tracker({ accounts: data.accounts, cards: data.cards, imports: files, txs: data.txs }) : null;
  // false, or the step of the picker: 'bank' then 'card'.
  const [edit, setEdit] = useState(() => (data.accounts.length + data.cards.length ? false : 'bank'));
  // On a phone: the tiles, or the last 6 months instead of them. A tile
  // tapped opens how to get its statement.
  const [view, setView] = useState('now');
  const [focus, setFocus] = useState(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => { track('picture_open'); }, []);
  if (!t) return html`<${Sheet} title="השלמת התמונה" onClose=${onClose}><span class="muted">טוען…</span><//>`;
  if (edit) return html`<${Sheet} title="הבנקים והכרטיסים שלכם" onClose=${onClose}><${Picker} data=${data} step=${edit} onStep=${setEdit} onDone=${() => setEdit(false)} /><//>`;
  const full = t.tasks.length === 0;
  // Saved before the companies were chosen, and not recognised by name.
  const unknown = sourcesOf({ accounts: data.accounts, cards: data.cards }).filter((x) => !x.provider);
  const now = t.months[t.months.length - 1];
  const info = (r) => {
    const x = r.source;
    const st = statusFor(t, r);
    const sub = x.kind === 'card'
      ? (x.count > 1 ? x.count + ' כרטיסים · ' : '') + 'חיוב ' + (x.billingDay || 10) + '.' + Number((st.key || now).slice(5))
      : monthName(st.key || now);
    // The card's own name too, when it says more than the company (רמי לוי).
    const own = x.count === 1 && x.name && !x.name.includes((providerOf(x.provider) || {}).name || x.name) && x.name !== nameOf(x) ? x.name + ' · ' : '';
    return { x, st, sub: own + sub, due: st.status === 'missing' || st.status === 'partial' };
  };
  // A row for each bank account and card company, as in a settings list:
  // its logo, its month, and a pill (להעלות / הועלה). A tap opens how to
  // get the statement, in three steps, with the site and the upload.
  const item = (r, idx = 0) => {
    const { x, st, sub, due } = info(r);
    const p = providerOf(x.provider);
    return html`<li key=${x.id} class=${'pic-task pic-item is-' + st.status}>
      <button type="button" class="pic-item-main" style=${'--i:' + idx} onClick=${() => setFocus(x.id)} aria-label=${nameOf(x) + ': ' + (due ? 'חסר' : st.status === 'ok' ? 'הועלה' : 'עוד לא הגיע הזמן')}>
        ${p ? html`<${Logo} provider=${p.key} size="s" />` : html`<span class="logo-chip logo-s logo-blank" aria-hidden="true"><${Icon} name=${x.kind === 'card' ? 'money' : 'assets'} size=${18} /></span>`}
        <span class="pic-item-t"><b>${nameOf(x)}</b><small>${sub}${st.status === 'partial' ? ' · הקובץ לא שלם' : ''}</small></span>
        ${!p ? html`<span class="pic-pill pick">${x.kind === 'card' ? 'איזו חברה?' : 'איזה בנק?'}</span>` : due ? html`<span class="pic-pill todo">להעלות</span>` : st.status === 'ok' ? html`<span class="pic-pill ok">הועלה</span>` : html`<span class="pic-pill">עוד לא</span>`}
        <span class="pic-chev" aria-hidden="true">‹</span>
      </button>
    </li>`;
  };
  const banks = t.rows.filter((r) => r.source.kind === 'bank');
  const cards = t.rows.filter((r) => r.source.kind === 'card');
  const rows = [...banks, ...cards];
  const sel = focus && rows.find((r) => r.source.id === focus);
  const panel = sel && (() => {
    const { x, st, sub, due } = info(sel);
    const p = providerOf(x.provider);
    const when = x.kind === 'card' ? 'החיוב של ' + (x.billingDay || 10) + '.' + Number((st.key || now).slice(5)) : 'עובר ושב, ' + monthName(st.key || now);
    const close = () => { setClosing(true); setTimeout(() => { setClosing(false); setFocus(null); }, 220); };
    const choose = (key) => saveRow(x.kind === 'card' ? 'credit_cards' : 'bank_accounts', { id: x.id, provider: key })
      .then(() => { track('picture_named'); showToast('נשמר: ' + nameOf({ ...x, provider: key })); })
      .catch(() => showToast('לא נשמר. נסו שוב.'));
    if (!p) {
      const banks = PROVIDERS.filter((q) => q.kind === 'bank');
      const cos = PROVIDERS.filter((q) => q.kind === 'card');
      const grid = (list, label) => html`<div class="pic-pickgrid">${list.map((q) => html`<button type="button" key=${q.key} class="pic-pickone" aria-label=${label ? label + ' ' + q.name : q.name} onClick=${() => choose(q.key)}><${Logo} provider=${q.key} size="m" /></button>`)}</div>`;
      return html`<div class=${'pic-veil' + (closing ? ' out' : '')} onClick=${(e) => { if (e.target === e.currentTarget) close(); }}>
        <div class="pic-focus" role="dialog" aria-label=${x.name}>
          <div class="pic-focus-head"><span class="logo-chip logo-m logo-blank" aria-hidden="true"><${Icon} name=${x.kind === 'card' ? 'money' : 'assets'} size=${20} /></span><span><h3>${x.name}</h3><small class="muted">${x.kind === 'card' ? 'של איזו חברה הכרטיס?' : 'באיזה בנק החשבון?'} לחיצה אחת, ונציג את הלוגו ואת הדרך להוריד את הפירוט.</small></span>
            <button type="button" class="icon-btn" aria-label="סגירה" onClick=${close}><${Icon} name="x" size=${16} /></button></div>
          ${x.kind === 'card' ? html`${grid(cos)}<p class="pic-group" style="margin:4px 2px 0">או כרטיס שהבנק הנפיק</p>${grid(banks, 'כרטיס של בנק')}` : grid(banks)}
          <button type="button" class="btn btn-ghost" onClick=${() => { setFocus(null); onUpload(x); }}><${Icon} name="upload" size=${16} />להעלות את הקובץ, ולזהות לבד</button>
          <p class="pic-safe"><${Icon} name="spark" size=${14} />לא בטוחים? מעלים את הפירוט, ונזהה את החברה מתוכו.</p>
        </div></div>`;
    }
    return html`<div class=${'pic-veil' + (closing ? ' out' : '')} onClick=${(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="pic-focus" role="dialog" aria-label=${nameOf(x)}>
        <div class="pic-focus-head">${p ? html`<${Logo} provider=${p.key} size="m" />` : null}<span><h3>הפירוט של ${nameOf(x)}</h3><small class="muted">${when}${x.count > 1 ? ' · ' + x.count + ' כרטיסים, פירוט אחד' : ''}</small></span>
          <button type="button" class="icon-btn" aria-label="סגירה" onClick=${close}><${Icon} name="x" size=${16} /></button></div>
        ${st.status === 'ok' ? html`<p class="pic-focus-ok">הפירוט של החודש כבר כאן. אפשר להעלות שוב אם משהו חסר.</p>`
          : st.status === 'waiting' ? html`<p class="muted pic-focus-ok">הפירוט של החודש עוד לא זמין. נזכיר לכם ביום שאחרי החיוב.</p>` : null}
        <ol class="pic-how">${howSteps(x.kind, x.provider).map((h, i) => html`<li key=${i} style=${'--i:' + i}>${h}</li>`)}</ol>
        <span class="sr-only">${howTo(x.kind, x.provider)}</span>
        <div class="pic-focus-acts">
          <button type="button" class="btn" onClick=${() => { setFocus(null); onUpload(x); }}><${Icon} name="upload" size=${16} />להעלות את הקובץ</button>
          ${p && html`<a class="btn btn-ghost" href=${p.url} target="_blank" rel="noopener noreferrer">לאתר של ${p.name} <span aria-hidden="true">↗</span></a>`}
        </div>
        <p class="pic-safe"><${Icon} name="lock" size=${14} />לא נבקש מכם סיסמה. את הקובץ מורידים בעצמכם מהאתר הרשמי.</p>
      </div></div>`;
  })();
  const history = html`<div class="card pic-history">
        <div class="pic-h-row"><h3 class="pic-h" style="margin:0">6 החודשים האחרונים</h3>${view === 'history' && html`<button type="button" class="btn-text" onClick=${() => setView('now')}>→ חזרה</button>`}</div>
        <div class="pic-table" role="table" aria-label="פירוטים לפי חודש">
          <div class="pic-tr pic-th" role="row"><span role="columnheader"><span class="sr-only">חשבון</span></span>${t.months.map((k) => html`<span role="columnheader" key=${k}>${monthShort(k)}</span>`)}</div>
          ${t.rows.map((r) => html`<div class="pic-tr" role="row" key=${r.source.id}>
            <span role="rowheader" class="pic-src"><${SiteLogo} source=${r.source} /><small>${r.source.kind === 'bank' ? 'עו״ש' : r.source.count > 1 ? r.source.count + ' כרטיסים' : r.source.last4 || ''}</small></span>
            ${r.months.map((m, i) => html`<span role="cell" key=${m.key}>${m.status === 'missing' || m.status === 'partial'
              ? html`<button type="button" class=${'pic-dot is-' + m.status} style=${'--i:' + i} title=${STATUS[m.status] + ': ' + monthName(m.key) + ' · להעלות'} aria-label=${nameOf(r.source) + ', ' + monthName(m.key) + ': ' + STATUS[m.status] + '. להעלות'} onClick=${() => onUpload(r.source)}>${m.status === 'partial' ? '!' : '+'}</button>`
              : html`<span class=${'pic-dot is-' + m.status} style=${'--i:' + i} title=${STATUS[m.status] + ': ' + monthName(m.key)} aria-label=${nameOf(r.source) + ', ' + monthName(m.key) + ': ' + STATUS[m.status]}>${m.status === 'ok' ? '✓' : ''}</span>`}</span>`)}
          </div>`)}
        </div>
        <div class="pic-legend"><span><i class="pic-dot is-ok"></i>הועלה</span><span><i class="pic-dot is-missing"></i>חסר</span><span><i class="pic-dot is-partial"></i>חלקי</span><span><i class="pic-dot is-waiting"></i>עוד לא הגיע הזמן</span></div>
        <p class="faint" style="font-size:12px;line-height:1.5;margin:6px 0 0">כרטיס נספר לפי חודש החיוב; חשבון בנק לפי החודש הקלנדרי. חיוב הכרטיס שמופיע בבנק לא נספר פעמיים. הלוגואים שייכים לבעליהם, ואין לנו קשר עסקי איתם.</p>
      </div>`;
  return html`<${Sheet} title="השלמת התמונה" onClose=${onClose} full=${true}>
    <div class=${'pic' + (view === 'history' ? ' pic-only-history' : '')}>
      <div class="pic-now">
      <div class=${'pic-summary' + (full ? ' is-full' : '')}>
        <span class="pic-ring2" role="img" aria-label=${t.ring.done + ' מתוך ' + t.ring.total + ' הועלו'}>
          <svg viewBox="0 0 42 42" width="92" height="92" aria-hidden="true"><circle cx="21" cy="21" r="18" fill="none" class="bg" /><circle cx="21" cy="21" r="18" fill="none" class="fg" pathLength="100" stroke-dasharray=${(t.ring.pct || 0.01) + ' 100'} style=${t.ring.pct ? '' : 'stroke-opacity:0'} /></svg>
          <b class="num">${t.ring.done}/${t.ring.total}</b></span>
        <div><span class="pic-eyebrow">${monthName(now)}</span>
          <h3 class="pic-hero-t">${full ? 'התמונה מלאה' : t.tasks.length === 1 ? 'נשאר פירוט אחד' : 'נשארו ' + t.tasks.length + ' פירוטים'}</h3>
          <p class="muted">${full ? 'כל המספרים של החודש מדויקים.' : 'פירוט אחד לכל חברה, וזה הכול.'}</p>
          ${t.streak > 1 && html`<span class="pic-streak">${t.streak} חודשים ברצף עם תמונה מלאה</span>`}</div>
      </div>
      ${unknown.length > 0 && html`<p class="pic-hint">${unknown.length === 1 ? 'לשורה אחת עוד אין לוגו' : 'ל-' + unknown.length + ' שורות עוד אין לוגו'}: לחצו עליה ובחרו את החברה.</p>`}
      ${banks.length > 0 && html`<p class="pic-group">חשבון בנק</p><ul class="pic-list">${banks.map((r, i) => item(r, i))}</ul>`}
      ${cards.length > 0 && html`<p class="pic-group">כרטיסי אשראי</p><ul class="pic-list">${cards.map((r, i) => item(r, banks.length + i))}</ul>`}
      <div class="pic-links"><button type="button" class="btn-text" onClick=${() => setEdit('bank')}>עריכת בנקים וכרטיסים</button>
        <button type="button" class="btn-text pic-hist-btn" onClick=${() => setView('history')}>6 החודשים האחרונים</button></div>
      </div>
      ${history}
      ${panel}
    </div>
  <//>`;
}
