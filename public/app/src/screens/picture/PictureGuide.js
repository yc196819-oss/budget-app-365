import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { providerOf, nameOf, monthName, howSteps, guideOrder } from '../../domain/sources.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { track } from '../../lib/telemetry.js';
import { Logo } from './Picture.js';

// "Complete the picture", one thing at a time: how much is left (and how
// little time it takes), then one account or card per screen with its month,
// one button and how to get the file; after each upload a ✓ and the next.
// The step being uploaded is remembered on the device, so coming back from
// the upload sheet lands on its ✓ (or on it again, when nothing was saved).
const AT = 'guide:at';
const label = (x) => (x.kind === 'bank' ? 'עו״ש ' + nameOf(x) : nameOf(x) + (x.last4 ? ' ••' + x.last4 : ''));

export function PictureGuide({ tasks, accounts, onUpload, onAll }) {
  const steps = guideOrder(tasks, accounts);
  const [at] = useState(() => readLocal(AT, ''));
  const back = at && !steps.some((s) => s.source.id === at) ? at : '';
  const [screen, setScreen] = useState(() => (back ? 'done' : at && steps.some((s) => s.source.id === at) ? 'step' : 'intro'));
  // Skipped steps wait at the end (remembered across the upload sheet).
  const [skipped, setSkippedState] = useState(() => { try { return JSON.parse(readLocal('guide:skip', '[]')); } catch (_e) { return []; } });
  const setSkipped = (list) => { writeLocal('guide:skip', JSON.stringify(list)); setSkippedState(list); };
  const [doneName, setDoneName] = useState(() => back && readLocal('guide:atname', '') || '');
  useEffect(() => { if (back) writeLocal(AT, ''); }, []);
  const left = [...steps.filter((s) => !skipped.includes(s.source.id)), ...steps.filter((s) => skipped.includes(s.source.id))];
  const [focusId, setFocusId] = useState(() => (at && !back ? at : ''));
  const cur = screen === 'step' ? (left.find((s) => s.source.id === focusId) || left[0]) : left[0];
  const total = steps.length + (doneName ? 1 : 0);
  const pos = total - left.length + 1;
  const minutes = Math.max(1, steps.length);
  const bars = html`<div class="pg-bars" aria-hidden="true">${Array.from({ length: total }, (_, i) => html`<i key=${i} class=${i < pos - 1 ? 'done' : i === pos - 1 ? 'on' : ''}></i>`)}</div>`;
  const tile = (x, size) => html`<span class=${'pg-tile ' + size}>${providerOf(x.provider) ? html`<${Logo} provider=${x.provider} size=${size === 'l' ? 'm' : 's'} />` : html`<${Icon} name=${x.kind === 'card' ? 'money' : 'assets'} size=${size === 'l' ? 28 : 20} />`}</span>`;
  const upload = (x) => { writeLocal(AT, x.id); writeLocal('guide:atname', label(x)); track('guide_upload'); onUpload(x); };

  if (screen === 'intro' || !cur) {
    if (!cur) return null;
    // Grouped by bank: a small heading wherever the bank changes.
    let lastBank = null;
    return html`<div class="pg">
      <div class="pg-hero"><small>התמונה שלכם כמעט מלאה</small>
        <h2>${steps.length === 1 ? 'עוד פירוט אחד,' : 'עוד ' + steps.length + ' פירוטים,'}<br />וסיימתם</h2>
        <p>מעלים אחד אחד. בכל שלב נראה בדיוק מאיפה להוריד.</p>
        <span class="pg-pill"><${Icon} name="clock" size=${14} /> בערך ${minutes === 1 ? 'דקה' : minutes + ' דקות'}</span></div>
      <ul class="pg-list">${steps.map((s, i) => {
        const bankHead = s.source.kind === 'bank' ? s.bank : s.bank.replace(/^יורד מ/, '');
        const head = bankHead && bankHead !== lastBank ? html`<li class="pg-bank" key=${'h' + i}>${bankHead}</li>` : null;
        lastBank = bankHead || lastBank;
        return [head, html`<li key=${s.source.id} class="pg-mini" style=${'--i:' + i}>${tile(s.source, 's')}<span><b>${label(s.source)}</b><small>${s.source.kind === 'card' && s.bank ? s.bank + ' · ' : ''}${monthName(s.key)}</small></span><span class="pg-time">דקה</span></li>`];
      })}</ul>
      <button type="button" class="btn pg-go" onClick=${() => { track('guide_start'); setSkipped([]); setScreen('step'); }}>בואו נתחיל</button>
      <button type="button" class="pg-link" onClick=${onAll}>לראות את כל החשבונות והכרטיסים</button>
    </div>`;
  }

  if (screen === 'done') {
    return html`<div class="pg">
      ${bars}
      <div class="pg-card pg-center">
        <span class="pg-check" aria-hidden="true"><${Icon} name="check" size=${40} stroke=${3} /></span>
        <h2>${doneName || 'הפירוט'} מעודכן</h2>
        <p class="muted">התנועות נכנסו וממוינות.</p>
        <div class="pg-next">${tile(cur.source, 's')}<span><b>הבא: ${label(cur.source)}</b><small>${cur.bank ? cur.bank + ' · ' : ''}פירוט ${monthName(cur.key)}${left.length === 1 ? ' · האחרון!' : ''}</small></span></div>
        <button type="button" class="btn pg-go" onClick=${() => setScreen('step')}>להמשיך</button>
      </div>
    </div>`;
  }

  const x = cur.source;
  const p = providerOf(x.provider);
  return html`<div class="pg">
    ${bars}
    <div class="pg-card pg-center" key=${x.id}>
      ${tile(x, 'l')}
      <h2>${label(x)}</h2>
      ${cur.bank && html`<p class="muted pg-bankline">${cur.bank}</p>`}
      <span class="pg-month">פירוט ${monthName(cur.key)}${cur.status === 'partial' ? ' · הקובץ הקודם לא היה שלם' : ''}</span>
      <button type="button" class="btn pg-go" onClick=${() => upload(x)}><${Icon} name="upload" size=${18} /> להעלות את הקובץ</button>
      <div class="pg-how"><b>איך מורידים, ב-3 צעדים:</b>
        <ol>${howSteps(x.kind, x.provider).map((h, i) => html`<li key=${i}>${h}${i === 0 && x.kind === 'card' && x.last4 ? ' (הכרטיס ' + x.last4 + ')' : ''}</li>`)}</ol></div>
    </div>
    <div class="pg-foot">
      ${left.length > 1 ? html`<button type="button" class="pg-link faint" onClick=${() => { setFocusId(''); setSkipped([...skipped.filter((id) => id !== x.id), x.id]); track('guide_skip_step'); }}>לא עכשיו, לדלג</button>` : html`<button type="button" class="pg-link faint" onClick=${onAll}>לכל החשבונות</button>`}
      ${p && p.url && html`<a class="pg-link" href=${p.url} target="_blank" rel="noopener noreferrer">לאתר של ${p.name} ‹</a>`}
    </div>
  </div>`;
}
