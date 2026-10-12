import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CATS } from '../../domain/trips.js';
import { money } from '../../domain/format.js';
import { tripChat } from '../../data/trips.js';
import { useAiSetting } from '../advisor/useAiSetting.js';

const STARTERS = ['לא צריך לינה, ישנים אצל המשפחה', 'האוכל ממומן לנו', 'יש לי כבר ₪2,000 בצד לטיול'];

// What the plan already knows about this family, as chips; ✕ takes one back.
export function PrefChips({ prefs, onClear, onForget }) {
  const chips = [
    ...prefs.skip.map((k) => ({ k, text: CATS[k].icon + ' ' + CATS[k].label + ': לא צריך' })),
    ...Object.entries(prefs.covered).map(([k, v]) => ({ k, text: CATS[k].icon + ' ' + CATS[k].label + ': ' + (v === 'all' ? 'ממומן' : 'ממומן ' + money(v)) })),
    ...Object.entries(prefs.fixed).map(([k, v]) => ({ k, text: CATS[k].icon + ' ' + CATS[k].label + ': ' + money(v) })),
    ...Object.entries(prefs.pct).map(([k, v]) => ({ k, text: CATS[k].icon + ' ' + CATS[k].label + ' ' + (v > 0 ? '+' : '') + v + '%' }))
  ];
  if (!chips.length && !prefs.notes.length && !prefs.funding) return null;
  return html`<div class="trip-prefs">
    ${chips.map((c) => html`<span class="trip-pref" key=${c.text}>${c.text}<button type="button" aria-label=${'לבטל: ' + c.text} onClick=${() => onClear(c.k)}>✕</button></span>`)}
    ${prefs.funding > 0 && html`<span class="trip-pref">💰 כבר יש ${money(prefs.funding)}<button type="button" aria-label="לבטל את הכסף שכבר יש" onClick=${() => onClear('funding')}>✕</button></span>`}
    ${prefs.notes.map((n) => html`<span class="trip-pref note" key=${n}>📝 ${n}<button type="button" aria-label=${'לשכוח: ' + n} onClick=${() => onForget(n)}>✕</button></span>`)}
  </div>`;
}

// The trip chat: tell what is different for you, the plan follows.
// context = what the advisor sees now; onChanges gets the cleaned changes.
export function TripChat({ context, onChanges }) {
  const aiOn = useAiSetting();
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [msgs.length, busy]);

  const send = async (text) => {
    const t = String(text || '').trim();
    if (!t || busy) return;
    setDraft(''); setError(''); setBusy(true);
    const history = msgs.slice(-10);
    setMsgs((m) => [...m, { role: 'me', text: t }]);
    try {
      const out = await tripChat({ message: t, history, context });
      setMsgs((m) => [...m, { role: 'ai', text: out.reply }]);
      if (out.changes && Object.keys(out.changes).length) onChanges(out.changes);
    } catch (err) {
      setError(err.message || 'היועץ לא זמין כרגע. נסו שוב.');
    } finally { setBusy(false); }
  };

  if (!aiOn) return html`<div class="card muted" style="font-size:14px">💬 כדי להתאים את הטיול בשיחה, הפעילו את היועץ (AI) בפרופיל.</div>`;
  return html`<div class="card stack trip-chat" style="gap:10px">
    <b>💬 להתאים לנו</b>
    <span class="faint" style="font-size:13px">ספרו מה שונה אצלכם: איפה ישנים, מה ממומן, מחיר שכבר ידוע, כסף שכבר יש בצד. התוכנית תתעדכן.</span>
    ${msgs.length > 0 && html`<div class="dchat-log" ref=${logRef} aria-live="polite">
      ${msgs.map((m, i) => html`<div class=${'dmsg ' + (m.role === 'ai' ? 'ai' : 'me')} key=${i}>${m.role === 'ai' && html`<small>✨ היועץ</small>`}<span>${m.text}</span></div>`)}
      ${busy && html`<div class="dmsg ai"><small>✨ היועץ</small><span class="adv-thinking"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>מעדכן את התוכנית…</span></div>`}
    </div>`}
    ${msgs.length === 0 && html`<div class="chips">${STARTERS.map((s) => html`<button type="button" class="chip" disabled=${busy} onClick=${() => send(s)}>${s}</button>`)}</div>`}
    ${error && html`<span class="hint" role="alert" style="color:var(--danger)">${error}</span>`}
    <form class="dchat-compose" onSubmit=${(e) => { e.preventDefault(); send(draft); }}>
      <input class="input" value=${draft} maxlength="600" onInput=${(e) => setDraft(e.target.value)} placeholder="למשל: בפריז אנחנו אצל אחי, לא צריך לינה" aria-label="הודעה ליועץ הטיול" disabled=${busy} />
      <button type="submit" class="btn" style="flex:none" disabled=${busy || !draft.trim()}>שליחה</button>
    </form>
  </div>`;
}
