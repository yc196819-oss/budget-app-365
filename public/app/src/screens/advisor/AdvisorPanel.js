import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { buildSummary, parseReply, starters, newTitle, historyFor } from '../../domain/advisor.js';
import { listConversations, openConversation, createConversation, addMessage, setPrivate, loadMemories, streamReply } from '../../data/advisor.js';
import { setAiEnabled } from '../../lib/settings.js';
import { canListen, listen, canSpeak, speak, stopSpeaking } from '../../lib/speech.js';
import { useAiSetting } from './useAiSetting.js';
import { LearnReview } from './LearnReview.js';
import { normalizeItems, learnContext, learnMessages, worthLearning } from '../../domain/learn.js';
import { askLearnings, applyLearnings } from '../../data/learn.js';
import { readLocal, writeLocal } from '../../lib/storage.js';

// How many messages of a conversation were already looked at for learning,
// so the "save what I learned?" offer does not repeat for the same messages.
const learnedFrom = (id) => Number(readLocal('learned:' + id, 0)) || 0;
const markLearned = (id, n) => writeLocal('learned:' + id, n);

const when = (iso) => { const d = new Date(iso); return d.getDate() + '.' + (d.getMonth() + 1); };

// The advisor: recent conversations (the household's, shared unless
// private, the same ones the current app shows), and a chat that knows the
// numbers and the screen the person is on. Question in writing or by voice,
// answer can be read aloud.
export function AdvisorPanel({ data, session, screen }) {
  const aiOn = useAiSetting();
  const hid = session.household && session.household.household_id;
  const me = session.user.id;
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(false);
  const [conv, setConv] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [listening, setListening] = useState(null);
  const [speaking, setSpeaking] = useState(null);
  // "What I learned": null, or { status: loading|review|saving|done|error, items, result, error }
  const [learn, setLearn] = useState(null);
  const [offer, setOffer] = useState(false);
  const memories = useRef(null);
  const logRef = useRef(null);
  const abort = useRef(null);

  const names = data.members || {};
  const memberName = (id) => (id === me ? (names[id] || 'אני') : (names[id] || 'בן/בת הזוג'));

  const refresh = () => listConversations(hid).then((l) => { setList(l); setListError(false); }).catch(() => setListError(true));
  useEffect(() => { if (hid) refresh(); return () => { if (abort.current) abort.current.abort(); stopSpeaking(); }; }, [hid]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [conv]);

  const open = async (id) => {
    setError(''); setSuggestions([]); setLearn(null); setOffer(false);
    try { setConv(await openConversation(id)); } catch (_err) { setError('לא הצלחנו לפתוח את השיחה. נסו שוב.'); }
  };

  const send = async (text) => {
    const msg = String(text || '').trim();
    if (!msg || busy || !aiOn) return;
    setBusy(true); setError(''); setSuggestions([]); setDraft(''); setOffer(false);
    let c = conv;
    try {
      if (!c || !c.id) {
        const row = await createConversation({ hid, userId: me, title: newTitle(msg, screen) });
        c = { ...row, is_private: !!row.is_private, messages: [] };
      }
      const userMsg = { role: 'user', text: msg, author_id: me };
      const aiMsg = { role: 'ai', text: '', author_id: me, pending: true };
      const history = historyFor(c.messages, memberName);
      c = { ...c, messages: [...c.messages, userMsg, aiMsg] };
      setConv(c);
      await addMessage({ conversationId: c.id, hid, userId: me, role: 'user', text: msg });
      if (!memories.current) memories.current = await loadMemories(hid).catch(() => []);
      const summary = buildSummary({ ...data, userId: me, userName: memberName(me), memories: memories.current, screen });
      let raw = '';
      abort.current = new AbortController();
      await streamReply({ summary, history, message: msg, authorName: memberName(me) }, (delta) => {
        raw += delta;
        setConv((cur) => cur && { ...cur, messages: cur.messages.map((m) => (m === aiMsg || (m.pending && m.role === 'ai') ? { ...m, text: parseReply(raw).text } : m)) });
      }, abort.current.signal);
      const reply = parseReply(raw);
      const finalText = reply.text || 'לא התקבלה תשובה. נסו לנסח אחרת.';
      setConv((cur) => cur && { ...cur, messages: cur.messages.map((m) => (m.pending ? { role: 'ai', text: finalText, author_id: me } : m)) });
      setSuggestions(reply.suggestions);
      // The full reply is saved, with the follow-ups, as the current app does.
      await addMessage({ conversationId: c.id, hid, userId: me, role: 'ai', text: raw || finalText });
      // Offer to save what was said, when the person mentioned an amount or a decision.
      if (worthLearning([...c.messages.slice(0, -1)], learnedFrom(c.id))) setOffer(true);
      refresh();
    } catch (err) {
      setConv((cur) => cur && { ...cur, messages: cur.messages.filter((m) => !m.pending) });
      setError(err.name === 'AbortError' ? '' : (err.message || 'משהו השתבש. נסו שוב.'));
    }
    abort.current = null;
    setBusy(false);
  };

  const startLearn = async () => {
    setOffer(false); setError('');
    setLearn({ status: 'loading' });
    try {
      if (!memories.current) memories.current = await loadMemories(hid).catch(() => []);
      const ctx = { ...data, memories: memories.current };
      const raw = await askLearnings({ messages: learnMessages(conv.messages, memberName), context: learnContext(ctx) });
      setLearn({ status: 'review', items: normalizeItems(raw, ctx) });
    } catch (err) {
      setLearn({ status: 'error', error: err.message || 'משהו השתבש. נסו שוב.' });
    }
  };
  const applyLearn = async (chosen) => {
    setLearn((l) => ({ ...l, status: 'saving' }));
    const result = await applyLearnings(chosen, { hid, userId: me, conversationId: conv.id });
    markLearned(conv.id, conv.messages.length);
    memories.current = null;
    setLearn({ status: 'done', result });
  };
  const closeLearn = () => {
    if (learn && learn.status === 'review') markLearned(conv.id, conv.messages.length);
    setLearn(null);
  };
  const dismissOffer = () => { markLearned(conv.id, conv.messages.length); setOffer(false); };

  const mic = () => {
    if (listening) { listening(); setListening(null); return; }
    const stop = listen({ onText: (t) => setDraft((d) => (d ? d + ' ' : '') + t), onEnd: () => setListening(null), onError: () => { setListening(null); setError('לא הצלחנו לשמוע. בדקו שיש הרשאה למיקרופון.'); } });
    setListening(() => stop);
  };
  const toggleSpeak = (i, text) => {
    if (speaking === i) { stopSpeaking(); setSpeaking(null); return; }
    speak(text, () => setSpeaking(null));
    setSpeaking(i);
  };
  const togglePrivate = async () => {
    try { await setPrivate(conv.id, !conv.is_private); setConv({ ...conv, is_private: !conv.is_private }); refresh(); } catch (_err) { setError('לא נשמר. נסו שוב.'); }
  };

  if (!hid) return html`<div class="card muted">היועץ זמין אחרי שמתחברים למשק בית.</div>`;

  const offCard = !aiOn && html`<div class="card adv-off">
    <b>היועץ כבוי</b><span>שום נתון לא נשלח ל-AI. אפשר עדיין לקרוא שיחות קודמות.</span>
    <button type="button" class="att-btn" style="--tone:var(--accent)" onClick=${() => setAiEnabled(true)}>להפעיל את היועץ</button>
  </div>`;

  // ── a conversation ──
  if (conv) {
    const mine = conv.user_id === me;
    return html`<div class="adv">
      <div class="adv-bar">
        <button type="button" class="btn-text" onClick=${() => { stopSpeaking(); setConv(null); setSuggestions([]); setLearn(null); setOffer(false); refresh(); }}>‹ כל השיחות</button>
        <span style="flex:1"></span>
        ${conv.id && aiOn && !learn && conv.messages.some((m) => m.role === 'user') && html`<button type="button" class="chip learn-btn" disabled=${busy} onClick=${startLearn}>💡 מה למדתי</button>`}
        ${conv.id && mine && html`<button type="button" class="chip" aria-pressed=${String(conv.is_private)} onClick=${togglePrivate}>${conv.is_private ? '🔒 פרטית' : '👥 משותפת'}</button>`}
      </div>
      ${!mine && html`<span class="faint" style="font-size:12px">שיחה ש${memberName(conv.user_id)} פתח/ה. אפשר להמשיך אותה.</span>`}
      ${learn ? html`<${LearnReview} state=${learn} onChange=${(items) => setLearn((l) => ({ ...l, items }))} onApply=${applyLearn} onCancel=${closeLearn} onRetry=${startLearn} />` : html`
      <div class="adv-log" ref=${logRef} aria-live="polite">
        ${conv.messages.length === 0 && html`<div class="muted" style="font-size:14px;text-align:center;padding:16px 0">שאלו כל דבר על הכסף שלכם</div>`}
        ${conv.messages.map((m, i) => html`<div class=${'adv-msg ' + (m.role === 'user' ? (m.author_id === me ? 'me' : 'partner') : 'ai')} key=${m.id || i}>
          ${m.role === 'user' && m.author_id !== me && html`<small>${memberName(m.author_id)}</small>`}
          ${m.pending && !m.text
            ? html`<span class="adv-thinking" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>היועץ חושב…</span>`
            : html`<span class=${m.pending ? 'adv-streaming' : ''}>${m.text}</span>`}
          ${m.role === 'ai' && !m.pending && m.text && canSpeak() && html`<button type="button" class="adv-speak" aria-label=${speaking === i ? 'להפסיק להקריא' : 'להקריא'} onClick=${() => toggleSpeak(i, m.text)}>${speaking === i ? '■' : '🔊'}</button>`}
        </div>`)}
      </div>
      ${suggestions.length > 0 && html`<div class="chips">${suggestions.map((s) => html`<button type="button" class="chip" disabled=${busy || !aiOn} onClick=${() => send(s)}>${s}</button>`)}</div>`}
      ${error && html`<div class="adv-err" role="alert">${error}</div>`}
      ${offer && !busy && aiOn && html`<div class="card learn-offer" role="status"><span>💡 סיפרתם משהו שכדאי לשמור. לעדכן את היעדים והנתונים לפי השיחה?</span>
        <div class="learn-actions"><button type="button" class="btn" onClick=${startLearn}>לבדוק מה למדתי</button><button type="button" class="btn-text" onClick=${dismissOffer}>לא עכשיו</button></div></div>`}
      ${offCard || html`<${Composer} draft=${draft} setDraft=${setDraft} busy=${busy} onSend=${() => send(draft)} onMic=${canListen() ? mic : null} listening=${!!listening} />`}`}
    </div>`;
  }

  // ── recent conversations ──
  return html`<div class="adv">
    ${offCard}
    ${aiOn && html`<div class="stack" style="gap:8px">
      <b style="font-size:13px;color:var(--muted)">אפשר לשאול למשל</b>
      <div class="chips">${starters(screen).map((s) => html`<button type="button" class="chip" disabled=${busy} onClick=${() => { setConv({ id: null, user_id: me, is_private: false, messages: [] }); send(s); }}>${s}</button>`)}</div>
      <${Composer} draft=${draft} setDraft=${setDraft} busy=${busy} onSend=${() => { setConv({ id: null, user_id: me, is_private: false, messages: [] }); send(draft); }} onMic=${canListen() ? mic : null} listening=${!!listening} />
    </div>`}
    ${error && html`<div class="adv-err" role="alert">${error}</div>`}
    <div class="stack" style="gap:6px">
      <b style="font-size:13px;color:var(--muted)">שיחות אחרונות</b>
      ${list === null && !listError && html`<div class="list" aria-busy="true">${[0, 1, 2].map((i) => html`<div class="skel-row" key=${i}><span class="skel" style="width:60%"></span><span class="skel" style="width:35%"></span></div>`)}</div>`}
      ${listError && html`<span class="muted" style="font-size:13px">לא הצלחנו לטעון את השיחות. <button type="button" class="btn-text" onClick=${refresh}>לנסות שוב</button></span>`}
      ${list && list.length === 0 && html`<span class="muted" style="font-size:13px">עוד אין שיחות.</span>`}
      ${list && list.length > 0 && html`<div class="list">${list.map((c) => html`<button type="button" class="row" key=${c.id} onClick=${() => open(c.id)}>
        <span class="row-main"><b>${c.title || 'שיחה'}</b><span>${(c.user_id === me ? 'שלך' : 'של ' + memberName(c.user_id)) + (c.is_private ? ' · 🔒 פרטית' : '') + ' · ' + when(c.updated_at)}</span></span>
      </button>`)}</div>`}
    </div>
  </div>`;
}

function Composer({ draft, setDraft, busy, onSend, onMic, listening }) {
  return html`<form class="adv-compose" onSubmit=${(e) => { e.preventDefault(); onSend(); }}>
    <input class="input" value=${draft} onInput=${(e) => setDraft(e.target.value)} placeholder=${listening ? 'מקשיב…' : 'שאלו את היועץ'} aria-label="שאלה ליועץ" disabled=${busy} />
    ${onMic && html`<button type="button" class=${'icon-btn adv-mic' + (listening ? ' on' : '')} aria-label=${listening ? 'להפסיק הקלטה' : 'להקליט שאלה'} aria-pressed=${String(listening)} onClick=${onMic} disabled=${busy}>🎙️</button>`}
    <button type="submit" class="btn" disabled=${busy || !draft.trim()}>${busy ? html`<span class="spinner" aria-label="שולח"></span>` : 'לשאול'}</button>
  </form>`;
}
