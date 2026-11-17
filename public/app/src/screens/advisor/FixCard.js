import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { updateTx } from '../../data/household.js';
import { saveRule } from '../../data/rules.js';
import { undoPatches, ruleOffer } from '../../domain/advisorFix.js';
import { merchantKey } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { track } from '../../lib/telemetry.js';

const dm = (iso) => { const [, m, d] = String(iso).split('-'); return Number(d) + '.' + Number(m); };

// Changes the advisor proposes, shown before anything changes: each
// transaction, what it is now and what it will be. "כן" makes them (all or
// none), "לבטל" puts them back, and one business moved to one category can be
// kept as a rule. The advisor never deletes.
export function FixCard({ fix, hid, categories = [] }) {
  const [state, setState] = useState('ask'); // ask | busy | done | undone | no | failed
  const [rule, setRule] = useState(null);    // null | 'ask' | 'saved' | 'skip'
  const { changes, dropped } = fix;
  if (!changes.length) return dropped ? html`<div class="fix-card fix-none" role="note">היועץ הציע שינוי שלא מתאים לנתונים, ולכן לא הוצג. אפשר לנסח שוב, או לתקן ב"כסף ← לוחצים על התנועה".</div>` : null;
  const offer = ruleOffer(changes);
  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || '';

  const apply = async () => {
    setState('busy');
    const done = [];
    try {
      for (const c of changes) { await updateTx(c.id, c.patch); done.push(c); }
      setState('done');
      track('advisor_fix', { n: changes.length });
      if (offer) setRule('ask');
    } catch (_e) {
      // All or none: what was already changed goes back.
      for (const u of undoPatches(done)) await updateTx(u.id, u.patch).catch(() => {});
      setState('failed');
    }
  };
  const undo = async () => {
    setState('busy');
    try { for (const u of undoPatches(changes)) await updateTx(u.id, u.patch); setState('undone'); setRule(null); track('advisor_fix_undo'); }
    catch (_e) { setState('done'); }
  };
  const keepRule = async () => {
    try { await saveRule({ hid, tx: offer.tx, category_id: offer.category_id, subcategory_id: offer.subcategory_id }); setRule('saved'); track('advisor_fix_rule'); }
    catch (_e) { setRule('skip'); }
  };

  return html`<div class=${'fix-card' + (state === 'done' ? ' is-done' : '')} role="group" aria-label="שינויים שהיועץ מציע">
    ${state === 'ask' || state === 'busy' || state === 'failed' ? html`
      <span class="fix-t"><${Icon} name="edit" size=${14} />היועץ מציע לשנות ${changes.length === 1 ? 'תנועה אחת' : changes.length + ' תנועות'}</span>
      <ul class="fix-rows">${changes.map((c) => html`<li key=${c.id}>
        <span class="fix-tx"><span>${dm(c.tx.tx_date)} · ${c.tx.description}</span><b class="num">${money(Math.abs(Number(c.tx.amount)))}</b></span>
        <span class="fix-ch"><s>${c.before}</s><span aria-hidden="true">←</span><b>${c.after}</b></span>
      </li>`)}</ul>
      ${state === 'failed' && html`<span class="adv-err" role="alert">השינוי לא נשמר, ושום דבר לא השתנה. נסו שוב.</span>`}
      <div class="fix-acts"><button type="button" class="btn" disabled=${state === 'busy'} onClick=${apply}>${state === 'busy' ? 'משנים…' : 'כן, לשנות' + (changes.length > 1 ? ' (' + changes.length + ')' : '')}</button>
        <button type="button" class="btn btn-ghost" disabled=${state === 'busy'} onClick=${() => { setState('no'); track('advisor_fix_no'); }}>לא</button></div>
      <small class="fix-note">שום דבר לא משתנה עד שלוחצים "כן". אפשר לבטל אחר כך.</small>` : ''}
    ${state === 'done' && html`<div class="fix-ok" role="status"><${Icon} name="check" size=${16} />${changes.length === 1 ? 'התנועה שונתה' : 'שונו ' + changes.length + ' תנועות'}<button type="button" class="btn-text" onClick=${undo}>לבטל</button></div>
      ${rule === 'ask' && html`<div class="fix-rule"><span>לשמור את זה לפעם הבאה? כל תנועה של ${merchantKey(offer.tx.description) || offer.tx.description} תסווג לבד כ${catName(offer.subcategory_id) || catName(offer.category_id)}.</span>
        <div class="fix-acts"><button type="button" class="btn" onClick=${keepRule}>כן, תמיד</button><button type="button" class="btn btn-ghost" onClick=${() => setRule('skip')}>רק הפעם</button></div></div>`}
      ${rule === 'saved' && html`<div class="fix-ok"><${Icon} name="check" size=${16} />נשמר. מעכשיו זה יסווג לבד, גם בפירוטים הבאים.</div>`}`}
    ${state === 'undone' && html`<div class="fix-ok fix-back">השינוי בוטל. הכול חזר כמו שהיה.</div>`}
    ${state === 'no' && html`<div class="fix-ok fix-back">בסדר, לא שיניתי כלום.</div>`}
  </div>`;
}
