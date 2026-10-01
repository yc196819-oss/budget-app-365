import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { VOTES, STATUS, voteValid, votesFor } from '../../domain/decisions.js';
import { answer } from '../../data/decisions.js';
import { showToast } from '../../lib/toast.js';

// The partner's answer: approve, not now, or let's talk. A reason is needed
// unless approving, so a "no" always comes with a why.
export function AnswerSheet({ decision, votes, userId, memberIds, nameOf, onClose }) {
  const prev = votesFor(decision, votes).find((v) => v.user_id === userId);
  const [vote, setVote] = useState(prev ? prev.vote : null);
  const [note, setNote] = useState(prev && prev.note ? prev.note : '');
  const [busy, setBusy] = useState(false);
  const ok = voteValid(vote, note);

  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    try {
      const st = await answer({ decision, userId, vote, note, memberIds });
      onClose();
      showToast(st === 'approved' ? 'אושר, ונוסף לתוכנית כהוצאה מתוכננת' : 'התשובה נשלחה');
    } catch (_err) {
      setBusy(false);
      showToast('לא נשמר. נסו שוב.');
    }
  };

  return html`<${Sheet} title=${decision.title} onClose=${onClose}>
    <form class="stack" onSubmit=${submit}>
      <div class="muted" style="font-size:14px">${nameOf(decision.created_by)} רוצה לקנות ב-<b class="num">${money(decision.amount)}</b>${decision.note ? html`<br />למה: ${decision.note}` : ''}</div>
      <div class="vote-choices" role="radiogroup" aria-label="התשובה שלך">
        ${Object.entries(VOTES).map(([key, v]) => html`<button type="button" role="radio" aria-checked=${String(vote === key)} class=${'vote-choice' + (vote === key ? ' on' : '')} style=${'--tone:' + v.tone} onClick=${() => setVote(key)}>
          <span class="vote-icon">${v.icon}</span>${v.label}</button>`)}
      </div>
      <label class="field"><span>${vote && vote !== 'approve' ? 'למה (חובה)' : 'הערה (לא חובה)'}</span>
        <textarea class="input" rows="3" maxlength="500" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder=${vote === 'not_now' ? 'למשל: בואו נחכה לבונוס בדצמבר' : vote === 'talk' ? 'על מה חשוב לך לדבר' : 'מילה טובה תמיד עוזרת'}></textarea></label>
      ${vote === 'talk' && html`<span class="hint">הכרטיס יופיע ב"${STATUS.talk}" לרבע השעה הזוגית של השבוע.</span>`}
      <button type="submit" class="btn" disabled=${busy || !ok}>${busy ? 'שולח…' : 'לשלוח תשובה'}</button>
    </form>
  <//>`;
}
