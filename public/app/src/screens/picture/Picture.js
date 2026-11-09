import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { PROVIDERS, providerOf, tracker, monthName, monthShort, howTo } from '../../domain/sources.js';
import { listSourceFiles, saveRow, archiveCard } from '../../data/household.js';
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
      <small class="muted">${missing ? t.tasks[0].title : t.streak > 1 ? t.streak + ' חודשים ברצף עם תמונה מלאה' : 'התמונה של החודש מלאה ומדויקת'}</small></span>
    <span aria-hidden="true">‹</span></button>`;
}

// Choosing the banks and card companies, and the details reminders need.
function Picker({ data, onDone }) {
  const sources = tracker({ accounts: data.accounts, cards: data.cards }).sources;
  const has = (key) => sources.some((s) => s.provider === key);
  const [busy, setBusy] = useState('');
  const add = async (p) => {
    if (has(p.key)) { showToast(p.name + ' כבר ברשימה. אפשר להוסיף עוד ' + (p.kind === 'card' ? 'כרטיס' : 'חשבון') + ' למטה.'); return; }
    setBusy(p.key);
    try {
      await (p.kind === 'card' ? saveRow('credit_cards', { name: p.name, provider: p.key, billing_day: 10 }) : saveRow('bank_accounts', { name: p.name, bank_name: p.name, provider: p.key }));
      track('picture_add');
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy('');
  };
  const another = async (s) => {
    const p = providerOf(s.provider);
    try { await (s.kind === 'card' ? saveRow('credit_cards', { name: (p ? p.name : 'כרטיס') + ' נוסף', provider: s.provider, billing_day: s.billingDay || 10 }) : saveRow('bank_accounts', { name: (p ? p.name : 'חשבון') + ' נוסף', bank_name: p ? p.name : null, provider: s.provider })); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  const set = async (s, patch) => {
    try { await saveRow(s.kind === 'card' ? 'credit_cards' : 'bank_accounts', { id: s.id, ...patch }); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  const remove = async (s) => {
    try { await archiveCard(s.id); showToast('הכרטיס הוסר מהרשימה. הקניות שלו נשארות.'); } catch (_e) { showToast('לא הוסר. נסו שוב.'); }
  };
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const grid = (kind) => html`<div class="pic-grid">${PROVIDERS.filter((p) => p.kind === kind).map((p) => html`<button type="button" key=${p.key} class=${'pic-pick' + (has(p.key) ? ' on' : '')} aria-pressed=${has(p.key)} disabled=${busy === p.key} onClick=${() => add(p)}><${Logo} provider=${p.key} size="l" /><span class="sr-only">${p.name}</span></button>`)}</div>`;
  return html`<div class="stack pic-picker">
    <p class="muted" style="margin:0;line-height:1.55">סמנו את כל הבנקים וחברות האשראי שלכם, גם של בן או בת הזוג. כך נדע אילו פירוטים חסרים בכל חודש, ונזכיר לכם בזמן.</p>
    <h3 class="pic-h">בנקים</h3>${grid('bank')}
    <h3 class="pic-h">כרטיסי אשראי</h3>${grid('card')}
    ${sources.length > 0 && html`<h3 class="pic-h">הפרטים לתזכורות</h3>
      <ul class="pic-details">${sources.map((s) => html`<li key=${s.id}>
        <${Logo} provider=${s.provider} name=${s.name} size="s" />
        <span class="pic-d-name"><b>${s.name}</b>
          ${!s.provider && html`<select class="input" aria-label=${'החברה של ' + s.name} onChange=${(e) => set(s, { provider: e.currentTarget.value || null })}><option value="">איזו חברה?</option>${PROVIDERS.filter((p) => p.kind === s.kind).map((p) => html`<option value=${p.key}>${p.name}</option>`)}</select>`}</span>
        ${s.kind === 'card' ? html`<label class="pic-d-field">יום חיוב<select class="input" value=${s.billingDay || 10} onChange=${(e) => set(s, { billing_day: Number(e.currentTarget.value) })}>${days.map((d) => html`<option value=${d}>${d}</option>`)}</select></label>
            <label class="pic-d-field">4 ספרות<input key=${'l4' + (s.last4 || '')} class="input num" inputmode="numeric" maxlength="4" defaultValue=${s.last4 || ''} placeholder="1234" onChange=${(e) => { const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 4); set(s, { last4: v.length === 4 ? v : null }); }} /></label>`
          : html`<label class="pic-d-field">המשכורת נכנסת ב-<select class="input" value=${s.salaryDay || ''} onChange=${(e) => set(s, { salary_day: Number(e.currentTarget.value) || null })}><option value="">לא יודע</option>${days.map((d) => html`<option value=${d}>${d}</option>`)}</select></label>`}
        <span class="pic-d-actions">${s.provider && html`<button type="button" class="btn-text" onClick=${() => another(s)}>+ עוד ${s.kind === 'card' ? 'כרטיס' : 'חשבון'}</button>`}
          ${s.kind === 'card' && html`<button type="button" class="btn-text" style="color:var(--danger)" onClick=${() => remove(s)}>להסיר</button>`}</span>
      </li>`)}</ul>`}
    <button type="button" class="btn" onClick=${onDone} disabled=${!sources.length}>${sources.length ? 'סיימתי (' + sources.length + ')' : 'בחרו לפחות אחד'}</button>
  </div>`;
}

export function PictureSheet({ data, onClose, onUpload }) {
  const files = useSourceFiles(data.hid, data.txs.length);
  const t = files ? tracker({ accounts: data.accounts, cards: data.cards, imports: files, txs: data.txs }) : null;
  const [edit, setEdit] = useState(() => !(data.accounts.length + data.cards.length));
  useEffect(() => { track('picture_open'); }, []);
  if (!t) return html`<${Sheet} title="השלמת התמונה" onClose=${onClose}><span class="muted">טוען…</span><//>`;
  if (edit) return html`<${Sheet} title="איפה הכסף שלכם?" onClose=${onClose}><${Picker} data=${data} onDone=${() => setEdit(false)} /><//>`;
  const full = t.tasks.length === 0;
  return html`<${Sheet} title="השלמת התמונה" onClose=${onClose}>
    <div class="stack pic">
      <div class=${'card pic-hero' + (full ? ' is-full' : '')}>
        <${Ring} pct=${t.ring.pct} label="הפירוטים שצריך עכשיו: " />
        <div><b class="pic-hero-t">${full ? 'התמונה מלאה!' : t.tasks.length === 1 ? 'עוד פירוט אחד!' : 'חסרים ' + t.tasks.length + ' פירוטים'}</b>
          <span class="muted">${t.ring.done} מתוך ${t.ring.total} הפירוטים שצריך עכשיו הועלו.${full ? ' עכשיו כל המספרים מדויקים.' : ' בלי כולם, חלק מההוצאות לא נספרות.'}</span>
          ${t.streak > 1 && html`<span class="pic-streak">${t.streak} חודשים ברצף עם תמונה מלאה</span>`}</div>
      </div>
      ${t.tasks.length > 0 && html`<ul class="pic-tasks">${t.tasks.map((x) => { const p = providerOf(x.source.provider); return html`<li key=${x.source.id} class=${'card pic-task is-' + x.status}>
        <${SiteLogo} source=${x.source} />
        <span class="pic-task-t"><b>${x.title}</b><small class="muted">${x.note}</small><small class="faint">${howTo(x.source.kind)}</small></span>
        <span class="pic-task-a">${p && html`<a class="btn btn-ghost" href=${p.url} target="_blank" rel="noopener noreferrer">לאתר של ${p.name} <span aria-hidden="true">↗</span></a>`}
          <button type="button" class="btn" onClick=${() => onUpload(x.source)}><${Icon} name="upload" size=${16} />להעלות</button></span>
      </li>`; })}</ul>`}
      <div class="card pic-history">
        <div class="pic-h-row"><h3 class="pic-h" style="margin:0">6 החודשים האחרונים</h3><button type="button" class="btn-text" onClick=${() => setEdit(true)}>עריכת בנקים וכרטיסים</button></div>
        <div class="pic-table" role="table" aria-label="פירוטים לפי חודש">
          <div class="pic-tr pic-th" role="row"><span role="columnheader"><span class="sr-only">חשבון</span></span>${t.months.map((k) => html`<span role="columnheader" key=${k}>${monthShort(k)}</span>`)}</div>
          ${t.rows.map((r) => html`<div class="pic-tr" role="row" key=${r.source.id}>
            <span role="rowheader" class="pic-src"><${SiteLogo} source=${r.source} /><small>${r.source.kind === 'card' && r.source.last4 ? r.source.last4 : r.source.kind === 'bank' ? 'עו״ש' : ''}</small></span>
            ${r.months.map((m, i) => html`<span role="cell" key=${m.key}>${m.status === 'missing' || m.status === 'partial'
              ? html`<button type="button" class=${'pic-dot is-' + m.status} style=${'--i:' + i} title=${STATUS[m.status] + ': ' + monthName(m.key) + ' · להעלות'} aria-label=${r.source.name + ', ' + monthName(m.key) + ': ' + STATUS[m.status] + '. להעלות'} onClick=${() => onUpload(r.source)}>${m.status === 'partial' ? '!' : '+'}</button>`
              : html`<span class=${'pic-dot is-' + m.status} style=${'--i:' + i} title=${STATUS[m.status] + ': ' + monthName(m.key)} aria-label=${r.source.name + ', ' + monthName(m.key) + ': ' + STATUS[m.status]}>${m.status === 'ok' ? '✓' : ''}</span>`}</span>`)}
          </div>`)}
        </div>
        <div class="pic-legend"><span><i class="pic-dot is-ok"></i>הועלה</span><span><i class="pic-dot is-missing"></i>חסר</span><span><i class="pic-dot is-partial"></i>חלקי</span><span><i class="pic-dot is-waiting"></i>עוד לא הגיע הזמן</span></div>
        <p class="faint" style="font-size:12px;line-height:1.5;margin:6px 0 0">לחיצה על לוגו פותחת את האתר הרשמי בחלון חדש, כדי להוריד משם את הפירוט. כרטיס נספר לפי חודש החיוב; חשבון בנק לפי החודש הקלנדרי.</p>
      </div>
      <div class="card pic-why"><b>למה צריך גם את הבנק וגם את האשראי?</b>
        <span><b>כרטיס האשראי</b> מראה מה קניתם: סופר, דלק, מסעדות.</span>
        <span><b>חשבון הבנק</b> מראה משכורת והכנסות, הוראות קבע, שכירות, ארנונה, גן, צ׳קים ומשיכות מזומן.</span>
        <span class="muted">חיוב הכרטיס שמופיע בבנק לא נספר פעמיים: הקניות נספרות מפירוט הכרטיס.</span></div>
    </div>
  <//>`;
}
