import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { threadFor, unreadCount } from '../../domain/decisions.js';
import { sendMessage, askAdvisor, markSeen, seenAt } from '../../data/decisions.js';
import { useAiSetting } from '../advisor/useAiSetting.js';

const time = (iso) => { const d = new Date(iso); return d.getDate() + '.' + (d.getMonth() + 1) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

// A conversation on the card, for three: the two partners and the advisor.
// Write to each other; one tap brings the advisor in, and it answers from the
// conversation and the household's current numbers. Closed by default, opens
// by itself when there is something new.
export function DecisionChat({ d, dec, data, userId, memberIds, nameOf }) {
  const aiOn = useAiSetting();
  const thread = threadFor(d, dec.messages || []);
  const unread = unreadCount(d, dec.messages || [], userId, seenAt(d.id));
  const [open, setOpen] = useState(unread > 0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(null); // null | '' (thinking) | the advisor's words so far
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const thinking = live !== null;

  useEffect(() => { if (open) markSeen(d.id); }, [open, thread.length]);
  useEffect(() => { if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [open, thread.length, live]);

  const send = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setError('');
    try { await sendMessage({ decision: d, userId, text }); setDraft(''); } catch (_err) { setError('ההודעה לא נשלחה. נסו שוב.'); }
    setSending(false);
  };
  const ask = async () => {
    setError(''); setLive('');
    try { await askAdvisor({ decision: d, data, userId, memberIds, onDelta: setLive }); } catch (err) { setError(err.message || 'היועץ לא זמין כרגע. נסו שוב.'); }
    setLive(null);
  };

  const label = thread.length ? 'שיחה · ' + thread.length + (thread.length === 1 ? ' הודעה' : ' הודעות') : 'לדבר על זה';
  return html`<div class=${'dchat' + (open ? ' open' : '')}>
    <button type="button" class="dchat-toggle" aria-expanded=${String(open)} onClick=${() => setOpen(!open)}>
      <span>💬 ${label}</span>${unread > 0 && html`<span class="nav-badge side" aria-label=${unread + ' חדשות'}>${unread}</span>`}<span class="faint">${open ? '▴' : '▾'}</span>
    </button>
    ${open && html`<div class="dchat-body">
      <div class="dchat-log" ref=${logRef} aria-live="polite">
        ${thread.length === 0 && !thinking && html`<span class="faint" style="font-size:13px">כתבו אחד לשני, או בקשו מהיועץ להצטרף ולהגיד מה דעתו לפי המספרים.</span>`}
        ${thread.map((m) => {
          const who = m.role === 'ai' ? 'ai' : m.author_id === userId ? 'me' : 'partner';
          return html`<div class=${'dmsg ' + who} key=${m.id}>
            <small>${m.role === 'ai' ? '🤖 היועץ' + (m.author_id ? ' · לבקשת ' + nameOf(m.author_id) : '') : who === 'me' ? 'את/ה' : nameOf(m.author_id)} · ${time(m.created_at)}</small>
            <span>${m.text}</span>
          </div>`;
        })}
        ${thinking && html`<div class="dmsg ai"><small>🤖 היועץ</small>${live ? html`<span class="adv-streaming">${live}</span>` : html`<span class="adv-thinking"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>בודק את המספרים…</span>`}</div>`}
      </div>
      ${error && html`<span class="hint" role="alert" style="color:var(--danger)">${error}</span>`}
      <form class="dchat-compose" onSubmit=${send}>
        <input class="input" value=${draft} maxlength="1000" onInput=${(e) => setDraft(e.target.value)} placeholder="לכתוב לבן/בת הזוג…" aria-label="הודעה על הכרטיס" disabled=${sending} />
        <button type="submit" class="btn" style="flex:none" disabled=${sending || !draft.trim()}>שליחה</button>
      </form>
      ${aiOn && html`<button type="button" class="btn-text advisor-ask" disabled=${thinking} onClick=${ask}>🤖 ${thread.some((m) => m.role === 'ai') ? 'לשאול את היועץ שוב' : 'להזמין את היועץ לשיחה'}</button>`}
    </div>`}
  </div>`;
}
