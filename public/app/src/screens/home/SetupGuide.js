import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { guideSteps, guideProgress, looseTxs } from '../../domain/guide.js';
import { askedKey } from '../../data/advisor.js';
import { setIncome } from '../../data/household.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { track } from '../../lib/telemetry.js';
import { showToast } from '../../lib/toast.js';
import { InviteButton } from '../../components/InviteButton.js';
import { CardSheet } from '../assets/CardSheet.js';
import { SortSheet } from '../money/SortSheet.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : null; };
const skipKey = (hid) => 'guide:skip:' + hid;
const laterKey = (hid) => 'guide:later:' + hid;
const readSet = (k) => { try { return new Set(JSON.parse(readLocal(k, '[]'))); } catch (_e) { return new Set(); } };

// "Let's set up your picture": the next step, open, with why it matters and
// one button that takes the person straight there. Done steps tick by
// themselves (from the data), so leaving and coming back resumes here.
export function SetupGuide({ data, userId, onImport, onAdd, onAsk }) {
  const [skipped, setSkipped] = useState(() => readSet(skipKey(data.hid)));
  const [later, setLater] = useState(() => Number(readLocal(laterKey(data.hid), '0')) > Date.now());
  const [open, setOpen] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [income, setIncomeText] = useState('');
  const [busy, setBusy] = useState(false);
  let asked = false;
  try { asked = localStorage.getItem(askedKey) === '1'; } catch (_e) { /* private mode */ }
  const steps = guideSteps(data, { asked, skipped });
  const p = guideProgress(steps);
  if (p.complete || (later && data.txs.length)) return null;
  const current = steps.find((s) => s.key === open && !s.done) || p.next;

  const skip = (key) => {
    const next = new Set(skipped); next.add(key);
    writeLocal(skipKey(data.hid), JSON.stringify([...next]));
    setSkipped(next); setOpen(null);
    track('guide_skip');
  };
  const hide = () => { writeLocal(laterKey(data.hid), String(Date.now() + 3 * 86400000)); setLater(true); };
  const saveIncome = async (e) => {
    e.preventDefault();
    const n = toNumber(income);
    if (!(n > 0) || busy) return;
    setBusy(true);
    try { await setIncome(n); showToast('נשמר. עכשיו רואים כמה נשאר החודש.'); track('guide_step'); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy(false);
  };
  const go = (s) => {
    track('guide_step');
    if (s.key === 'import') onImport();
    else if (s.key === 'sort') setSheet('sort');
    else if (s.key === 'budget') location.hash = '#/plans/budget';
    else if (s.key === 'card') setSheet('card');
    else if (s.key === 'ask') onAsk();
  };
  const loose = looseTxs(data.txs).length;

  return html`<section class="card stack setup-guide" aria-label="מסלול התחלה">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
      <b style="font-size:17px">${!data.txs.length ? 'בואו נסדר לכם את התמונה' : 'ממשיכים מאיפה שעצרתם'}</b>
      <span class="muted num" style="font-size:13px">${p.finished} מתוך ${p.total}</span>
    </div>
    <div class="guide-bar" role="progressbar" aria-valuemin="0" aria-valuemax=${p.total} aria-valuenow=${p.finished} aria-label="התקדמות" style="height:6px;border-radius:3px;background:var(--line);overflow:hidden">
      <i style=${'display:block;height:100%;background:var(--accent);width:' + Math.round((p.finished / Math.max(1, p.total)) * 100) + '%'}></i></div>
    <ol class="guide-steps" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px">
      ${steps.map((s, i) => {
        const isOpen = current && s.key === current.key;
        return html`<li key=${s.key} class=${'guide-step' + (s.done ? ' done' : '') + (isOpen ? ' open' : '')}>
          <button type="button" class="guide-head" aria-expanded=${String(!!isOpen)} disabled=${s.done} onClick=${() => setOpen(s.key)}
            style="display:flex;align-items:center;gap:10px;width:100%;background:none;border:0;padding:8px 0;color:inherit;font:inherit;text-align:start;cursor:pointer">
            <span aria-hidden="true" style=${'width:24px;height:24px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;flex:none;' + (s.done ? 'background:var(--income);color:#fff' : isOpen ? 'background:var(--accent);color:var(--accent-ink)' : 'border:1.5px solid var(--line)')}>${s.done ? '✓' : i + 1}</span>
            <span style=${'flex:1;' + (s.done ? 'text-decoration:line-through;opacity:.6' : s.skipped ? 'opacity:.55' : '')}>${s.title}${s.skipped ? ' · דילגתם' : ''}</span>
            ${!s.done && !isOpen && html`<span class="faint" style="font-size:12px">${s.time}</span>`}
          </button>
          ${isOpen && html`<div class="stack" style="gap:10px;padding:0 34px 10px 0">
            <span class="muted" style="font-size:14px;line-height:1.55">${s.key === 'sort' && loose ? (loose === 1 ? 'תנועה אחת מחכה לקטגוריה. ' : loose + ' תנועות מחכות לקטגוריה. ') : ''}${s.why}</span>
            ${s.key === 'income' ? html`<form onSubmit=${saveIncome} style="display:flex;gap:8px">
                <input class="input num" inputmode="numeric" placeholder="למשל 18,000" aria-label="הכנסה חודשית נטו" value=${income} onInput=${(e) => setIncomeText(e.target.value)} style="flex:1;width:auto;min-width:0" />
                <button type="submit" class="btn" style="width:auto" disabled=${busy || !(toNumber(income) > 0)}>${s.cta}</button></form>`
              : s.key === 'partner' ? html`<${InviteButton} hid=${data.hid} userId=${userId} variant="btn" />`
              : html`<button type="button" class="btn" onClick=${() => go(s)}>${s.cta}</button>`}
            ${s.key === 'import' && html`<span style="font-size:14px;line-height:1.55;color:var(--income);font-weight:700">יש לכם כמה כרטיסים או כמה חשבונות בנק? מכניסים את כולם, והכל מסודר במקום אחד.</span>`}
            ${s.key === 'import' && html`<button type="button" class="btn-text" style="align-self:flex-start" onClick=${onAdd}>או להוסיף הוצאה ידנית / בקול</button>`}
            ${s.key !== 'import' && html`<button type="button" class="btn-text faint" style="align-self:flex-start;font-size:13px" onClick=${() => skip(s.key)}>${s.optional ? 'לא עכשיו' : 'לא רלוונטי לי'}</button>`}
          </div>`}
        </li>`;
      })}
    </ol>
    ${data.txs.length > 0 && html`<button type="button" class="btn-text faint" style="align-self:flex-start;font-size:13px" onClick=${hide}>להסתיר לכמה ימים</button>`}
    ${sheet === 'sort' && html`<${SortSheet} data=${data} onClose=${() => setSheet(null)} />`}
    ${sheet === 'card' && html`<${CardSheet} card=${null} accounts=${data.accounts} members=${data.members} userId=${userId} onClose=${() => setSheet(null)} />`}
  </section>`;
}
