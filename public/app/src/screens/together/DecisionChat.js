import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { threadFor, unreadCount, withDays, readBy, STATUS, outcome, needsMyAnswer, canConclude, isClosed, votesFor, VOTES, answerers } from '../../domain/decisions.js';
import { money, initials } from '../../domain/format.js';
import { sendMessage, askAdvisor, markSeen, seenAt, deleteMessage, sendTyping } from '../../data/decisions.js';
import { useAiSetting } from '../advisor/useAiSetting.js';
import { ConcludeSheet } from './ConcludeSheet.js';

const hm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const SEND = html`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>`;

// Words to start with, so each of us says what is going on inside, not only
// yes or no. They only begin the sentence; the rest is yours.
const OPENERS = ['💭 אני מרגיש/ה ש', '❤️ חשוב לי ש', '😟 מה שמדאיג אותי זה', '🤝 מה אם', '🙏 אני מבין/ה אותך, '];

// Messages of the same person a few minutes apart sit together; only the
// first of a run has the bubble's tail.
const sameRun = (a, b) => a && b && !a.day && !b.day && a.role === b.role && a.author_id === b.author_id && new Date(b.created_at) - new Date(a.created_at) < 5 * 60e3;

// The advisor's words, with its recommendation set apart.
function AdvisorText({ text }) {
  const i = text.indexOf('ההמלצה שלי:');
  if (i < 0) return html`<span class="wa-text">${text}</span>`;
  return html`<span class="wa-text">${text.slice(0, i).trim()}</span><span class="wa-rec">${text.slice(i).trim()}</span>`;
}

// On the card: the last message and how many are new; opens the conversation.
export function ChatPreview({ d, dec, userId, nameOf, onOpen }) {
  const thread = threadFor(d, dec.messages || []);
  const last = thread.at(-1);
  const unread = unreadCount(d, dec.messages || [], userId, seenAt(d.id, userId));
  const typing = dec.typing && dec.typing[d.id];
  const who = (m) => (m.role === 'ai' ? '✨ היועץ' : m.author_id === userId ? 'את/ה' : nameOf(m.author_id));
  return html`<button type="button" class=${'chat-preview' + (unread ? ' unread' : '')} onClick=${onOpen} aria-label=${'לפתוח את השיחה על ' + d.title + (unread ? ', ' + unread + ' הודעות חדשות' : '')}>
    <span class="chat-preview-ic" aria-hidden="true">💬</span>
    <span class="chat-preview-text">${typing ? html`<i>${nameOf(typing.userId)} מקליד/ה…</i>` : last ? html`<b>${who(last)}:</b> ${last.text.split('\n')[0]}` : html`<span class="muted">לדבר על זה ביחד</span>`}</span>
    ${last && html`<span class="chat-preview-time">${hm(last.created_at)}</span>`}
    ${unread > 0 ? html`<span class="chat-preview-count" aria-hidden="true">${unread}</span>` : html`<span class="chat-preview-go" aria-hidden="true">‹</span>`}
  </button>`;
}

// The conversation on a card, like a messaging app: the two of us and, when
// we ask, the advisor. Read ticks, "typing…", day lines, and the decision on
// top until we close it together.
export function ChatScreen({ d, dec, data, userId, memberIds, nameOf, onClose, onAnswer }) {
  const aiOn = useAiSetting();
  const thread = threadFor(d, dec.messages || []);
  const items = withDays(thread);
  const st = outcome(d, dec.votes, memberIds);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(null); // null | '' (thinking) | the advisor's words so far
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null); // my message with its actions open
  const [confirmDel, setConfirmDel] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const thinking = live !== null;
  const partners = memberIds.filter((id) => id !== userId);
  const typing = dec.typing && dec.typing[d.id];

  useEffect(() => { markSeen(d.id, userId); }, [thread.length]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [thread.length, live, typing]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !concluding) onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('chat-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('chat-open'); };
  }, [concluding]);

  const grow = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 132) + 'px'; };
  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setError('');
    try {
      await sendMessage({ decision: d, userId, text });
      setDraft('');
      if (inputRef.current) { inputRef.current.style.height = 'auto'; inputRef.current.focus(); }
    } catch (_err) { setError('ההודעה לא נשלחה. נסו שוב.'); }
    setSending(false);
  };
  const ask = async () => {
    setError(''); setLive('');
    try { await askAdvisor({ decision: d, data, userId, memberIds, onDelta: setLive }); } catch (err) { setError(err.message || 'היועץ לא זמין כרגע. נסו שוב.'); }
    setLive(null);
  };
  const remove = async (id) => {
    setPicked(null); setConfirmDel(false); setError('');
    try { await deleteMessage(id); } catch (_err) { setError('המחיקה נכשלה. נסו שוב.'); }
  };
  const opener = (o) => {
    const words = o.replace(/^\S+\s/, '');
    setDraft(words);
    setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(words.length, words.length); grow(el); } }, 0);
  };

  const votes = votesFor(d, dec.votes);
  const sub = typing ? nameOf(typing.userId) + ' מקליד/ה…' : partners.length ? 'את/ה, ' + partners.map(nameOf).join(', ') + (aiOn ? ' והיועץ' : '') : 'רק את/ה כרגע';
  return html`<div class="wa-scrim" onClick=${onClose}></div>
  <section class="wa" role="dialog" aria-modal="true" aria-label=${'שיחה: ' + d.title}>
    <header class="wa-head">
      <button type="button" class="wa-back" aria-label="חזרה" onClick=${onClose}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg></button>
      <span class="wa-faces" aria-hidden="true">${partners.slice(0, 2).map((id) => html`<span class="wa-face" key=${id}>${initials(nameOf(id))}</span>`)}<span class="wa-face me">${initials((data.members || {})[userId] || 'אני')}</span></span>
      <span class="wa-title"><b>${d.title}</b><small class=${typing ? 'typing' : ''} aria-live="polite">${sub}</small></span>
      <span class="wa-amount num">${money(d.amount)}</span>
    </header>

    <div class="wa-pin">
      <div class="wa-pin-row">
        <span class=${'status-chip st-' + st}>${STATUS[st]}</span>
        <span class="wa-votes">${answerers(d, memberIds).map((id) => { const v = votes.find((x) => x.user_id === id); return html`<span key=${id}>${v ? VOTES[v.vote].icon : '⏳'} ${nameOf(id)}</span>`; })}</span>
        ${!isClosed(d) && html`<span class="wa-pin-acts">
          ${needsMyAnswer(d, dec.votes, userId, memberIds) && html`<button type="button" class="wa-pill strong" onClick=${onAnswer}>לענות</button>`}
          ${canConclude(d) && partners.length > 0 && html`<button type="button" class="wa-pill" onClick=${() => setConcluding(true)}>📌 ${d.status === 'planned' ? 'לעדכן החלטה' : 'לסכם החלטה'}</button>`}
        </span>`}
      </div>
      ${d.summary && html`<div class="wa-summary"><b>📌 מה החלטנו</b><span>${d.summary}</span></div>`}
    </div>

    <div class="wa-log" ref=${logRef} aria-live="polite" onClick=${(e) => { if (!e.target.closest('.wa-msg.me')) { setPicked(null); setConfirmDel(false); } }}>
      ${thread.length === 0 && !thinking && html`<div class="wa-empty">
        <span class="wa-empty-art" aria-hidden="true">💞</span>
        <b>איך כל אחד מכם מרגיש עם זה?</b>
        <span>כאן מדברים בנחת: מה חשוב לכל אחד, מה מדאיג, ומה יכול לעבוד לשניכם. השיחה נשארת פתוחה עד שתסכמו יחד.</span>
        ${aiOn && html`<span class="wa-empty-hint">✨ אפשר להזמין את היועץ בכל רגע, והוא ייתן מקום לשניכם.</span>`}
      </div>`}
      ${items.map((m, i) => {
        if (m.day) return html`<div class="wa-day" key=${m.key}><span>${m.day}</span></div>`;
        const tail = !sameRun(items[i - 1], m);
        if (m.role === 'ai') {
          return html`<div class="wa-msg ai" key=${m.id}>
            <span class="wa-ai-head"><span class="wa-orb" aria-hidden="true">✨</span><b>היועץ</b>${m.author_id ? html`<small>לבקשת ${m.author_id === userId ? 'את/ה' : nameOf(m.author_id)}</small>` : ''}</span>
            <${AdvisorText} text=${m.text} />
            <span class="wa-meta">${hm(m.created_at)}</span></div>`;
        }
        const mine = m.author_id === userId;
        const read = mine && readBy(m, dec.reads || [], userId);
        return html`<div class=${'wa-msg ' + (mine ? 'me' : 'them') + (tail ? ' tail' : '') + (picked === m.id ? ' picked' : '')} key=${m.id} onClick=${mine ? () => { setPicked(picked === m.id ? null : m.id); setConfirmDel(false); } : undefined}>
          <span class="wa-text">${m.text}<span class="wa-meta">${hm(m.created_at)}${mine && html`<span class=${'wa-ticks' + (read ? ' read' : '')} aria-label=${read ? 'נקרא' : 'נשלח'}>${read ? '✓✓' : '✓'}</span>`}</span></span>
          ${picked === m.id && html`<span class="wa-actions" onClick=${(e) => e.stopPropagation()}>${confirmDel
            ? html`<button type="button" class="btn-text" onClick=${() => remove(m.id)}>כן, למחוק</button><button type="button" class="btn-text plain" onClick=${() => setConfirmDel(false)}>ביטול</button>`
            : html`<button type="button" class="btn-text" aria-label=${'למחוק את ההודעה: ' + m.text} onClick=${() => setConfirmDel(true)}>מחיקה</button>`}</span>`}
        </div>`;
      })}
      ${thinking && html`<div class="wa-msg ai"><span class="wa-ai-head"><span class="wa-orb" aria-hidden="true">✨</span><b>היועץ</b></span>${live ? html`<${AdvisorText} text=${live} />` : html`<span class="adv-thinking"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>קורא את השיחה ואת המספרים…</span>`}</div>`}
      ${typing && html`<div class="wa-msg them tail wa-typing" aria-label=${nameOf(typing.userId) + ' מקליד/ה'}><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`}
    </div>

    ${error && html`<span class="hint wa-error" role="alert">${error}</span>`}
    ${!isClosed(d) && html`<div class="wa-foot">
      ${!draft && html`<div class="wa-openers" role="group" aria-label="להתחיל משפט">${OPENERS.map((o) => html`<button type="button" class="wa-opener" key=${o} onClick=${() => opener(o)}>${o}</button>`)}</div>`}
      <form class="wa-compose" onSubmit=${(e) => { e.preventDefault(); send(); }}>
        <span class="wa-bar">
          <textarea ref=${inputRef} class="wa-input" rows="1" maxlength="4000" value=${draft} disabled=${sending} placeholder="הודעה" aria-label="הודעה בשיחה"
            onInput=${(e) => { setDraft(e.target.value); grow(e.target); sendTyping(d.id, userId); }}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }}></textarea>
          ${aiOn && html`<button type="button" class="wa-ai" disabled=${thinking} onClick=${ask} aria-label=${thread.some((m) => m.role === 'ai') ? 'לשאול את היועץ שוב' : 'להזמין את היועץ לשיחה'} title="להזמין את היועץ"><span class="wa-orb" aria-hidden="true">✨</span></button>`}
        </span>
        <button type="submit" class="wa-send" disabled=${sending || !draft.trim()} aria-label="שליחה">${SEND}</button>
      </form>
    </div>`}
    ${concluding && html`<${ConcludeSheet} d=${d} data=${data} dec=${dec} userId=${userId} memberIds=${memberIds} onClose=${() => setConcluding(false)} />`}
  </section>`;
}
