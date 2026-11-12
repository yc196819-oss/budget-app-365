import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { money } from '../../domain/format.js';
import { transferPairs, markedPairs } from '../../domain/transfers.js';
import { markTransfer, keepBoth } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';
import { track } from '../../lib/telemetry.js';

// Money that left one of the household's bank accounts and came into
// another: one pair at a time, with both lines, and a plain question. Only
// "yes" marks them (then neither is an expense or income); "no" is not asked
// again. The transfers marked before are listed below, each with an undo.
const dm = (iso) => String(iso || '').slice(5, 10).split('-').reverse().map(Number).join('.');

export function TransferSheet({ data, dupeOk, onClose }) {
  const [busy, setBusy] = useState('');
  const [showMarked, setShowMarked] = useState(false);
  const no = new Set([...dupeOk].filter((k) => String(k).startsWith('t:')).map((k) => k.slice(2)));
  const pairs = transferPairs(data.txs, { no });
  const marked = markedPairs(data.transfers || []);
  const acct = (id) => { const a = (data.accounts || []).find((x) => x.id === id); return a ? a.name || a.bank_name || 'חשבון בנק' : 'חשבון בנק'; };

  const yes = async (p) => {
    setBusy(p.key);
    try { await markTransfer([p.out.id, p.in.id], true); track('transfer_yes'); showToast('סומן: העברה בין החשבונות שלכם. ' + money(p.amount) + ' כבר לא נספרים כהוצאה וכהכנסה.', { undo: () => markTransfer([p.out.id, p.in.id], false).catch(() => showToast('לא הצלחנו לבטל. נסו שוב.')) }); }
    catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy('');
  };
  const nope = async (p) => {
    setBusy(p.key);
    try { await keepBoth('t:' + p.key); track('transfer_no'); showToast('בסדר, אלה תנועות רגילות. לא נשאל עליהן שוב.'); }
    catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy('');
  };
  const undo = async (m) => {
    const ids = [m.out, m.in].filter(Boolean).map((t) => t.id);
    try { await markTransfer(ids, false); showToast('בוטל: התנועות נספרות שוב כרגיל.'); } catch (_e) { showToast('לא הצלחנו לבטל. נסו שוב.'); }
  };
  const line = (t, dir) => html`<div class=${'tr-line ' + dir}>
    <span class="tr-arrow" aria-hidden="true">${dir === 'out' ? '−' : '+'}</span>
    <span class="tr-what"><b>${acct(t.account_id)}</b><small>${t.description || ''} · ${dm(t.tx_date)}</small></span>
    <b class="num tr-amt">${(dir === 'out' ? '−' : '+') + money(t.amount)}</b></div>`;

  return html`<${Sheet} title="העברות בין החשבונות שלכם" onClose=${onClose}>
    <div class="stack tr">
      ${pairs.length ? html`<p class="muted tr-intro">כשכסף עובר מחשבון שלכם לחשבון אחר שלכם, הוא לא הוצאה ולא הכנסה. מצאנו ${pairs.length === 1 ? 'זוג תנועות אחד שנראה' : pairs.length + ' זוגות תנועות שנראים'} כך. זה נכון?</p>`
        : html`<div class="tr-empty"><span class="tr-ok" aria-hidden="true"><${Icon} name="check" size=${26} stroke=${2.6} /></span><b>אין העברות לבדוק</b><span class="muted">כשנמצא כסף שיצא מחשבון אחד שלכם ונכנס לאחר, נשאל אתכם כאן.</span></div>`}
      ${pairs.map((p) => html`<div class="card tr-pair" key=${p.key}>
        ${line(p.out, 'out')}
        <span class="tr-link" aria-hidden="true">↓</span>
        ${line(p.in, 'in')}
        <div class="tr-q">${money(p.amount)} יצאו מ${acct(p.out.account_id)} ונכנסו ל${acct(p.in.account_id)}${p.gap ? ' (' + (p.gap === 1 ? 'יום אחד' : p.gap + ' ימים') + ' אחר כך)' : ' באותו יום'}.</div>
        <div class="tr-acts">
          <button type="button" class="btn" disabled=${busy === p.key} onClick=${() => yes(p)}>כן, זו העברה שלי</button>
          <button type="button" class="btn btn-ghost" disabled=${busy === p.key} onClick=${() => nope(p)}>לא, אלה תנועות רגילות</button>
        </div>
      </div>`)}
      ${marked.length > 0 && html`<button type="button" class="btn-text tr-marked-btn" aria-expanded=${String(showMarked)} onClick=${() => setShowMarked(!showMarked)}>${showMarked ? 'להסתיר' : 'העברות שסימנתם'} (${marked.length})</button>`}
      ${showMarked && html`<ul class="tr-marked">${marked.map((m, i) => html`<li key=${i}>
        <span><b>${money(m.amount)}</b><small class="muted">${m.out ? acct(m.out.account_id) : '?'} ← ${m.in ? acct(m.in.account_id) : '?'} · ${dm((m.out || m.in).tx_date)}</small></span>
        <button type="button" class="btn-text" onClick=${() => undo(m)}>לבטל</button></li>`)}</ul>`}
      <p class="faint tr-note">רק אתם מחליטים. שום דבר לא מסומן בלי אישור, ואפשר לבטל בכל רגע.</p>
    </div>
  <//>`;
}
