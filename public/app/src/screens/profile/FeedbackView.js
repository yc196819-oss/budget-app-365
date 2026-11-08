import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { sendFeedback, myFeedback, replyFeedback, attachImage, FEEDBACK_KIND } from '../../data/feedback.js';
import { FbImage, ImagePick } from '../../components/FbImage.js';
import { showToast } from '../../lib/toast.js';

const dm = (iso) => String(iso || '').slice(0, 10).split('-').reverse().slice(0, 2).join('.');
const hm = (iso) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : dm(iso); };
// What the person sees on each request.
function stateOf(f) {
  if (f.unread) return { label: 'תשובה חדשה', tone: 'new' };
  if (f.closed) return { label: f.helped ? 'סגורה · זה עזר' : 'נענתה · סגורה', tone: 'closed' };
  if (f.last_by === 'owner') return { label: 'מחכה לתשובה שלך', tone: 'ask' };
  return { label: 'פתוחה · מחכה לתשובה', tone: 'open' };
}

// "Problems and ideas": my requests (each a short conversation with the
// app's owner), a new one, and the answer with "it helped" / "still not
// working" (one more message reopens it).
export function FeedbackView({ userId, onBack }) {
  const [mine, setMine] = useState(null);
  const [open, setOpen] = useState(null); // a request id | 'new' | null
  const load = () => myFeedback(userId).then((l) => { setMine(l); return l; }).catch(() => { setMine([]); return []; });
  useEffect(() => { load(); }, []);
  const thread = mine && open && open !== 'new' ? mine.find((f) => f.id === open) : null;
  if (open === 'new') return html`<${NewRequest} onBack=${() => setOpen(null)} onSent=${() => { setOpen(null); load(); }} />`;
  if (thread) return html`<${Thread} f=${thread} onBack=${() => { setOpen(null); load(); }} reload=${load} />`;
  return html`<div class="stack feedback">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ חזרה</button>
    <b style="font-size:19px">הפניות שלי</b>
    <span class="muted" style="font-size:14px;line-height:1.55">משהו לא עובד? יש לכם רעיון? זה מגיע ישר אלינו, ואנחנו קוראים כל פנייה.</span>
    <button type="button" class="btn" onClick=${() => setOpen('new')}>+ פנייה חדשה</button>
    ${mine === null && html`<div class="skel-row"><span class="skel" style="width:60%"></span></div>`}
    <div class="stack my-feedback" style="gap:8px">
      ${(mine || []).map((f) => {
        const st = stateOf(f);
        const last = f.messages[f.messages.length - 1];
        return html`<button type="button" class=${'card fb-item fb-' + st.tone} key=${f.id} onClick=${() => setOpen(f.id)}>
          <span class="fb-item-top"><b>${FEEDBACK_KIND[f.kind].label} · ${f.text.split('\n')[0].slice(0, 40)}</b><span class="fb-time">${hm(f.last_at || f.created_at)}</span></span>
          <span class="fb-last">${last.author === 'owner' ? '' : 'שלחת: '}${last.text.split('\n')[0].slice(0, 80)}</span>
          <span class=${'fb-pill fb-pill-' + st.tone}>${st.label}</span>
        </button>`;
      })}
    </div>
  </div>`;
}

function NewRequest({ onBack, onSent }) {
  const [kind, setKind] = useState('bug');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    if (busy || text.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await sendFeedback({ kind, text: text.trim(), screen: String(location.hash || '').replace(/^#\//, '').split('/')[0] || 'home' });
      if (file && r && r.id) {
        try { await attachImage(r.id, file); } catch (err) { showToast('הפנייה נשלחה, אבל התמונה לא: ' + (err.message || 'נסו לצרף אותה שוב בפנייה.')); onSent(); return; }
      }
      showToast('נשלח. תודה! התשובה תופיע כאן.');
      onSent();
    } catch (err) { showToast(err.message || 'לא נשלח. נסו שוב.'); setBusy(false); }
  };
  return html`<form class="stack feedback" onSubmit=${send}>
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ הפניות שלי</button>
    <b style="font-size:19px">פנייה חדשה</b>
    <div class="chips" role="radiogroup" aria-label="סוג הפנייה">${Object.entries(FEEDBACK_KIND).map(([k, v]) => html`<button type="button" role="radio" class="chip" aria-checked=${String(kind === k)} aria-pressed=${String(kind === k)} onClick=${() => setKind(k)}><${Icon} name=${v.icon} size=${16} />${v.label}</button>`)}</div>
    <textarea class="input" rows="5" maxlength="2000" aria-label="הפנייה" value=${text} onInput=${(e) => setText(e.target.value)}
      placeholder=${kind === 'bug' ? 'מה ניסיתם לעשות, ומה קרה במקום?' : kind === 'idea' ? 'מה היה עוזר לכם?' : 'כתבו כאן'}></textarea>
    <${ImagePick} file=${file} onFile=${setFile} />
    <span class="muted" style="font-size:14px">לא צריך לכתוב פרטים אישיים או מספרי חשבון. בצילום מסך אפשר להסתיר סכומים, אבל לא חובה: רק אנחנו רואים אותו.</span>
    <button type="submit" class="btn" disabled=${busy || text.trim().length < 3}>${busy ? 'שולח…' : 'לשלוח'}</button>
  </form>`;
}

function Thread({ f, onBack, reload }) {
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const log = useRef(null);
  // Opening the answer marks it read (the owner sees ✓✓).
  useEffect(() => { if (f.unread) replyFeedback(f.id, { seen: true }).then(reload).catch(() => {}); }, [f.id]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [f.messages.length]);
  const send = async (e) => {
    if (e) e.preventDefault();
    if (busy || (draft.trim().length < 2 && !file)) return;
    setBusy(true);
    try {
      let reopened = false;
      if (draft.trim().length >= 2) { const r = await replyFeedback(f.id, { message: draft.trim() }); reopened = r.reopened; }
      if (file) await attachImage(f.id, file);
      setDraft(''); setFile(null); setReopening(false);
      showToast(reopened ? 'נשלח. הפנייה נפתחה מחדש, ונענה כאן.' : 'נשלח.');
      await reload();
    } catch (err) { showToast(err.message || 'לא נשלח. נסו שוב.'); }
    setBusy(false);
  };
  const helped = async () => {
    try { await replyFeedback(f.id, { helped: true }); showToast('תודה! שמחים שזה עובד.'); await reload(); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };
  const canWrite = !f.closed || reopening;
  return html`<div class="stack feedback fb-thread">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ הפניות שלי</button>
    <b style="font-size:17px">${FEEDBACK_KIND[f.kind].label} · ${f.closed ? 'נענתה ונסגרה' : 'פתוחה'}</b>
    <div class="wa-log fb-log" ref=${log} aria-live="polite">
      ${f.messages.map((m, i) => html`<div key=${i} class=${'fb-msg ' + (m.author === 'owner' ? 'them' : 'me')}>
        ${m.author === 'owner' && html`<small class="fb-from">"התקציב שלנו"</small>`}
        ${m.image ? html`<${FbImage} path=${m.image} />` : html`<span>${m.text}</span>`}
        <small class="fb-meta">${hm(m.created_at)}</small>
      </div>`)}
    </div>
    ${f.closed && !reopening && html`<div class="card stack fb-closed" style="gap:10px">
      ${f.helped ? html`<span style="font-weight:700;color:var(--income)">סגורה. סימנת שזה עזר, תודה!</span>` : html`
        <b>הפנייה נענתה ונסגרה. זה עזר?</b>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button type="button" class="btn" onClick=${helped}>כן, זה עזר</button>
          <button type="button" class="btn btn-ghost" onClick=${() => setReopening(true)}>עדיין לא עובד</button>
        </div>`}
      <span class="muted" style="font-size:14px">משהו אחר? פותחים פנייה חדשה.</span>
    </div>`}
    ${canWrite && html`<form class="fb-compose" onSubmit=${send}>
      ${reopening && html`<b style="font-size:15px">מה עדיין לא עובד? ההודעה תפתח את הפנייה מחדש.</b>`}
      <div style="display:flex;gap:8px;align-items:flex-end">
        <textarea class="input" rows="2" maxlength="2000" aria-label=${reopening ? 'מה עדיין לא עובד' : 'הודעה'} placeholder=${reopening ? 'כתבו מה קורה' : 'כתבו כאן'} value=${draft} onInput=${(e) => setDraft(e.target.value)} style="flex:1;min-width:0"></textarea>
        <button type="submit" class="btn" style="width:auto" disabled=${busy || (draft.trim().length < 2 && !file)}>${busy ? 'שולח…' : 'לשלוח'}</button>
      </div>
      <${ImagePick} file=${file} onFile=${setFile} />
    </form>`}
  </div>`;
}
