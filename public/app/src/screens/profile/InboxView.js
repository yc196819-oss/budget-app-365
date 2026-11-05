import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { adminFeedback, setFeedback, draftReply, FEEDBACK_KIND, FEEDBACK_STATUS } from '../../data/feedback.js';
import { showToast } from '../../lib/toast.js';
import { sortInbox, filterInbox } from '../../domain/inbox.js';

const QUICK = ['תודה, אנחנו בודקים', 'תוקן, נסו שוב', 'רעיון מצוין, נכנס לרשימה', 'אפשר צילום מסך?'];
// Draft with AI, by where things stand. Writing by hand stays as it is.
const DRAFTS = [['fixed', 'תוקן'], ['working', 'בטיפול'], ['explain', 'להסביר איך'], ['idea', 'תודה על הרעיון'], ['more', 'לבקש פרטים']];
const FILTERS = [['all', 'הכול'], ['unread', 'לא נקראו'], ['open', 'פתוחות'], ['bug', 'תקלות'], ['idea', 'רעיונות'], ['archived', 'ארכיון']];
const hm = (iso) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('.'); };

// The owner's requests, like a messaging app: a list with unread counts,
// and each request as a conversation.
export function InboxView() {
  const [items, setItems] = useState(undefined);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const load = () => adminFeedback().then((l) => { setItems(l); return l; });
  useEffect(() => { load(); }, []);
  if (items === undefined) return html`<span class="muted">טוען את הפניות…</span>`;
  if (items === null) return null;
  const f = open && items.find((x) => x.id === open);
  if (f) return html`<${InboxThread} f=${f} onBack=${() => setOpen(null)} reload=${load} patchLocal=${(p) => setItems((l) => l.map((x) => (x.id === f.id ? { ...x, ...p } : x)))} />`;
  const unread = items.filter((x) => x.unread > 0 && !x.archived).length;
  const shown = sortInbox(filterInbox(items, filter, q));
  return html`<div class="card stack admin-inbox inbox">
    <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:18px">פניות</b><span class="muted" style="font-size:14px"><b class="inbox-unread-count" style="color:var(--income)">${unread}</b> לא נקראו</span></div>
    <input class="input" type="search" placeholder="חיפוש בפניות" aria-label="חיפוש בפניות" value=${q} onInput=${(e) => setQ(e.target.value)} />
    <div class="chips" role="group" aria-label="סינון">${FILTERS.map(([k, l]) => html`<button type="button" class="chip" aria-pressed=${String(filter === k)} onClick=${() => setFilter(k)}>${l}</button>`)}</div>
    ${shown.length === 0 && html`<span class="muted" style="font-size:14px">${items.length ? 'אין פניות בסינון הזה.' : 'עוד אין פניות.'}</span>`}
    <div class="inbox-list">${shown.map((x) => {
      const last = x.messages.filter((m) => m.author !== 'note').slice(-1)[0];
      return html`<button type="button" class=${'inbox-row' + (x.unread ? ' is-unread' : '')} key=${x.id} onClick=${() => setOpen(x.id)}>
        <span class=${'inbox-avatar k-' + x.kind} aria-hidden="true">${x.who.replace('#', '').slice(0, 1)}</span>
        <span class="inbox-main">
          <span class="inbox-top"><b>${x.pinned ? 'מוצמד · ' : ''}${x.who}<span class="muted"> · ${FEEDBACK_KIND[x.kind].label}</span></b><span class="inbox-time">${hm(x.last_at)}</span></span>
          <span class="inbox-bottom"><span class="inbox-last">${last.author === 'owner' && html`<span class=${'inbox-ticks' + (x.readByUser ? ' read' : '')} aria-label=${x.readByUser ? 'נקרא' : 'נשלח'}>${x.readByUser ? '✓✓' : '✓'} </span>`}${last.text.split('\n')[0]}</span>${x.unread > 0 && html`<span class="inbox-badge" aria-label=${x.unread + ' לא נקראו'}>${x.unread}</span>`}</span>
          <span class=${'inbox-status s-' + x.status}>${FEEDBACK_STATUS[x.status]}</span>
        </span>
      </button>`;
    })}</div>
  </div>`;
}

function InboxThread({ f, onBack, reload, patchLocal }) {
  const [draft, setDraft] = useState('');
  const [mail, setMail] = useState(true);
  const [menu, setMenu] = useState(false);
  const [noting, setNoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState('');
  // What the owner typed so far is the gist; the AI writes it out. Nothing is sent.
  const aiDraft = async (status) => {
    setDrafting(status);
    try { setDraft(await draftReply(f.id, status, draft)); } catch (err) { showToast(err.message || 'לא הצלחנו לנסח. נסו שוב.'); } finally { setDrafting(''); }
  };
  const log = useRef(null);
  // Opening it marks it read for you.
  useEffect(() => { if (f.unread) { patchLocal({ unread: 0 }); setFeedback(f.id, { seen: true }).catch(() => {}); } }, [f.id]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [f.messages.length]);
  const act = async (body, done) => {
    setBusy(true);
    try {
      const r = await setFeedback(f.id, body);
      await reload();
      if (done) showToast(typeof done === 'function' ? done(r || {}) : done);
      return true;
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); return false; } finally { setBusy(false); }
  };
  const answer = async (close) => {
    const text = draft.trim();
    if (!text) return;
    if (noting) { if (await act({ note: text }, 'ההערה נשמרה (רק אתה רואה)')) { setDraft(''); setNoting(false); } return; }
    if (await act({ message: text, close, mail }, (r) => (close ? 'נשלח והפנייה נסגרה' : 'נשלח, הפנייה נשארת פתוחה') + (r.mailed ? '. נשלח גם במייל' : ''))) setDraft('');
  };
  const lastOwner = [...f.messages].reverse().find((m) => m.author === 'owner');
  return html`<div class="card stack inbox-thread">
    <div class="inbox-head">
      <button type="button" class="btn-text" onClick=${onBack} aria-label="חזרה לפניות">›</button>
      <span class=${'inbox-avatar k-' + f.kind} aria-hidden="true">${f.who.replace('#', '').slice(0, 1)}</span>
      <span style="flex:1;display:flex;flex-direction:column;min-width:0"><b>${f.who} · ${FEEDBACK_KIND[f.kind].label}</b><span class="muted" style="font-size:14px">${FEEDBACK_STATUS[f.status]}${f.closed ? ' · סגורה' : ' · פתוחה'}${f.helped === true ? ' · אמר שזה עזר' : ''}</span></span>
      <button type="button" class="icon-btn" aria-label="אפשרויות" aria-expanded=${String(menu)} onClick=${() => setMenu(!menu)}>⋮</button>
    </div>
    ${menu && html`<div class="inbox-menu stack" style="gap:10px">
      <b style="font-size:14px" class="muted">סטטוס</b>
      <div class="chips">${Object.entries(FEEDBACK_STATUS).map(([k, l]) => html`<button type="button" class="chip" aria-pressed=${String(f.status === k)} disabled=${busy} onClick=${() => act({ status: k })}>${l}</button>`)}</div>
      <div class="inbox-menu-grid">
        <button type="button" class="btn btn-ghost" disabled=${busy} onClick=${() => act({ pinned: !f.pinned }, f.pinned ? 'ההצמדה בוטלה' : 'הוצמד למעלה')}>${f.pinned ? 'לבטל הצמדה' : 'להצמיד למעלה'}</button>
        <button type="button" class="btn btn-ghost" disabled=${busy} onClick=${() => act({ unread: true }, 'סומן כלא נקרא').then(onBack)}>לסמן כלא נקרא</button>
        <button type="button" class="btn btn-ghost" onClick=${() => { setNoting(true); setMenu(false); }}>הערה פנימית</button>
        <button type="button" class="btn btn-ghost" disabled=${busy} onClick=${() => act({ archived: !f.archived }, f.archived ? 'הוחזר מהארכיון' : 'הועבר לארכיון').then(onBack)}>${f.archived ? 'להחזיר מהארכיון' : 'לארכיון'}</button>
      </div>
      <span class="muted" style="font-size:14px">מכשיר: ${f.device || '—'} · מסך: ${f.screen || '—'} · נפתחה ב-${hm(f.created_at)}${f.label && f.label !== f.who ? ' · ' + f.label : ''}</span>
    </div>`}
    <div class="wa-log inbox-log" ref=${log} aria-live="polite">
      ${f.messages.map((m, i) => html`<div key=${i} class=${'fb-msg ' + (m.author === 'owner' ? 'me' : m.author === 'note' ? 'note' : 'them')}>
        ${m.author === 'note' && html`<small class="fb-from">הערה פנימית (רק אתה רואה)</small>`}
        <span>${m.text}</span>
        <small class=${'fb-meta' + (m === lastOwner && f.readByUser ? ' read' : '')}>${hm(m.created_at)}${m.author === 'owner' ? (m === lastOwner && f.readByUser ? ' ✓✓' : ' ✓') : ''}</small>
      </div>`)}
    </div>
    ${!noting && html`<div class="inbox-ai stack" style="gap:6px">
      <span class="muted" style="font-size:13px">תשובה בעזרת AI לפי המצב. אפשר לכתוב קודם כמה מילים, והיא תנוסח מהן. הטיוטה נכנסת לתיבה, ואתה עורך ושולח.</span>
      <div class="chips">${DRAFTS.map(([k, l]) => html`<button type="button" class="chip" disabled=${!!drafting || busy} onClick=${() => aiDraft(k)}>${drafting === k ? 'מנסח…' : '✦ ' + l}</button>`)}</div>
    </div>`}
    ${!noting && html`<div class="chips inbox-quick">${QUICK.map((t) => html`<button type="button" class="chip" onClick=${() => setDraft(t)}>${t}</button>`)}</div>`}
    ${noting && html`<span class="inbox-note-mode">כותבים הערה פנימית: המשתמש לא יראה אותה. <button type="button" class="btn-text" onClick=${() => setNoting(false)}>ביטול</button></span>`}
    <textarea class="input" rows="3" maxlength="2000" aria-label=${noting ? 'הערה פנימית' : 'תשובה ל' + f.who} placeholder=${noting ? 'הערה לעצמך' : 'תשובה'} value=${draft} onInput=${(e) => setDraft(e.target.value)}></textarea>
    ${!noting && html`<label class="check" style="font-size:14px"><input type="checkbox" checked=${mail} onChange=${(e) => setMail(e.target.checked)} /><span>לשלוח גם במייל (בלי לראות את הכתובת)</span></label>`}
    ${noting
      ? html`<button type="button" class="btn" disabled=${busy || !draft.trim()} onClick=${() => answer(true)}>לשמור הערה</button>`
      : html`<div class="inbox-send">
        <button type="button" class="btn" disabled=${busy || !draft.trim()} onClick=${() => answer(true)}>לענות ולסגור</button>
        <button type="button" class="btn btn-ghost" disabled=${busy || !draft.trim()} onClick=${() => answer(false)}>לשאול אותו</button>
      </div>`}
  </div>`;
}
