import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { track } from '../../lib/telemetry.js';
import { askChatReport } from '../../data/advisor.js';
import { describeItem } from '../../domain/learn.js';
import { reportText } from '../../domain/chatReport.js';
import { Icon } from '../../components/Icon.js';

const shekel = (v) => '₪' + Math.round(v).toLocaleString('he-IL');
const count = (n, one, many) => (n === 1 ? one + ' אחת' : n + ' ' + many);
const dateHe = (d = new Date()) => d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear();

// "Save as PDF": the browser's own print dialog (it has "Save as PDF"), on a
// copy of the report put straight in the page body, removed afterwards.
function printReport() {
  const src = document.querySelector('.chat-report .chat-report-print');
  if (!src) return;
  const old = document.getElementById('print-root');
  if (old) old.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  root.dir = 'rtl';
  root.appendChild(src.cloneNode(true));
  document.body.appendChild(root);
  const done = () => { root.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  // Some browsers do not tell when printing ended.
  setTimeout(done, 60000);
}

// A report of the conversation (the owner first): the AI writes the words;
// the amounts are only ones written in the conversation, and "updated in
// the app" is what the advisor really changed here. Saved as a PDF through
// the browser's own print dialog, copied, or sent on WhatsApp.
export function ChatReport({ conv, messages, updated, onClose }) {
  const [state, setState] = useState({ status: 'loading' });
  const load = () => {
    setState({ status: 'loading' });
    askChatReport(messages).then((report) => { setState({ status: 'ready', report }); track('chat_report'); }, (err) => setState({ status: 'error', error: err.message }));
  };
  useEffect(load, []);

  const changes = (updated || []).filter((it) => !it.undone).map(describeItem);
  const title = String(conv.title || 'שיחה עם היועץ').replace(/ — [\d.]+$/, '');
  const when = dateHe();

  if (state.status === 'loading') return html`<div class="chat-report" aria-busy="true"><span class="adv-thinking" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>מכין דוח על השיחה…</span></div>`;
  if (state.status === 'error') return html`<div class="chat-report stack" style="gap:10px">
    <div class="adv-err" role="alert">${state.error}</div>
    <div style="display:flex;gap:8px"><button type="button" class="btn" onClick=${load}>לנסות שוב</button><button type="button" class="btn btn-ghost" onClick=${onClose}>חזרה לשיחה</button></div>
  </div>`;

  const r = state.report;
  const text = reportText({ title, when, report: r, changes });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState((s) => ({ ...s, copied: true })); track('chat_report_copy'); } catch (_e) { setState((s) => ({ ...s, copied: false, copyFailed: true })); }
  };
  return html`<div class="chat-report">
    <article class="chat-report-print" aria-label="דוח על השיחה">
      <header class="cr-cover">
        <small>דוח על השיחה עם היועץ · ${when}</small>
        <h3>${title}</h3>
        <p>${r.summary}</p>
        <div class="cr-pills">
          ${r.decisions.length > 0 && html`<span>${count(r.decisions.length, 'החלטה', 'החלטות')}</span>`}
          ${r.tasks.length > 0 && html`<span>${count(r.tasks.length, 'משימה', 'משימות')}</span>`}
          ${r.amounts.length > 0 && html`<span>${count(r.amounts.length, 'סכום', 'סכומים')}</span>`}
          ${changes.length > 0 && html`<span>${count(changes.length, 'עדכון', 'עדכונים')} באפליקציה</span>`}
        </div>
      </header>
      ${r.amounts.length > 0 && html`<section class="cr-sec">
        <h4><span class="cr-ico"><${Icon} name="money" size=${16} /></span>סכומים שעלו בשיחה</h4>
        <div class="cr-tiles">${r.amounts.map((a) => html`<div class="cr-tile"><b class="num">${shekel(a.amount)}</b><span>${a.label}</span></div>`)}</div>
      </section>`}
      ${r.decisions.length > 0 && html`<section class="cr-sec">
        <h4><span class="cr-ico"><${Icon} name="check" size=${16} /></span>מה החלטתם</h4>
        <ul class="cr-list">${r.decisions.map((d) => html`<li><span class="cr-mark done" aria-hidden="true"><${Icon} name="check" size=${13} stroke=${3} /></span>${d}</li>`)}</ul>
      </section>`}
      ${r.tasks.length > 0 && html`<section class="cr-sec">
        <h4><span class="cr-ico"><${Icon} name="clock" size=${16} /></span>מה נשאר לעשות</h4>
        <ul class="cr-list">${r.tasks.map((t) => html`<li><span class="cr-mark" aria-hidden="true"></span>${t}</li>`)}</ul>
      </section>`}
      ${changes.length > 0 && html`<section class="cr-sec">
        <h4><span class="cr-ico"><${Icon} name="edit" size=${16} /></span>מה עודכן באפליקציה</h4>
        <ul class="cr-list">${changes.map((c) => html`<li><span class="cr-dot" aria-hidden="true"></span>${c}</li>`)}</ul>
      </section>`}
      <p class="cr-foot">הדוח נכתב על ידי בינה מלאכותית מתוך השיחה, ויכול לטעות. הסכומים הם רק כאלה שנכתבו בשיחה.</p>
    </article>
    <div class="cr-actions">
      <button type="button" class="btn cr-pdf" onClick=${() => { track('chat_report_pdf'); printReport(); }}><${Icon} name="file" size=${18} />לשמור כ-PDF</button>
      <button type="button" class="btn btn-ghost" onClick=${copy}><${Icon} name=${state.copied ? 'check' : 'share'} size=${17} />${state.copied ? 'הועתק' : 'להעתיק'}</button>
      <a class="btn btn-ghost" href=${'https://wa.me/?text=' + encodeURIComponent(text)} target="_blank" rel="noopener" onClick=${() => track('chat_report_whatsapp')}><${Icon} name="chat" size=${17} />וואטסאפ</a>
    </div>
    ${state.copyFailed && html`<span class="muted" style="font-size:13px">לא הצלחנו להעתיק. אפשר לסמן את הטקסט ולהעתיק ידנית.</span>`}
    <button type="button" class="btn-text" onClick=${onClose}>‹ חזרה לשיחה</button>
  </div>`;
}
