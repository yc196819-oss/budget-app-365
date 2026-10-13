import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { MONTH_NAMES } from '../../domain/money.js';
import { endOfMonth } from '../../domain/decisions.js';
import { conclude, suggestSummary } from '../../data/decisions.js';
import { useAiSetting } from '../advisor/useAiSetting.js';
import { showToast } from '../../lib/toast.js';

// Closing the conversation with a decision: into the plan (on the month we
// chose), or we decided not to buy. What we agreed, in words, stays on the
// card; the advisor can draft it from the conversation.
export function ConcludeSheet({ d, data, dec, userId, memberIds, onClose }) {
  const aiOn = useAiSetting();
  const today = new Date();
  const months = Array.from({ length: 7 }, (_, i) => ({ value: endOfMonth(today, i), label: i === 0 ? 'החודש' : MONTH_NAMES[new Date(today.getFullYear(), today.getMonth() + i, 1).getMonth()] }));
  const [kind, setKind] = useState(d.status === 'planned' ? 'plan' : null);
  const [when, setWhen] = useState(() => {
    const w = d.wanted_by ? String(d.wanted_by).slice(0, 7) : '';
    return (months.find((m) => m.value.slice(0, 7) === w) || months[0]).value;
  });
  const [summary, setSummary] = useState(d.summary || '');
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);

  const draft = async () => {
    setDrafting(true);
    try { const t = await suggestSummary({ decision: d, data, userId, memberIds, onDelta: setSummary }); if (t) setSummary(t); } catch (err) { showToast(err.message || 'היועץ לא זמין כרגע.'); }
    setDrafting(false);
  };
  const save = async (e) => {
    e.preventDefault();
    if (!kind || busy) return;
    setBusy(true);
    try {
      await conclude({ decision: d, kind, summary, wantedBy: kind === 'plan' ? when : null, userId });
      onClose();
      showToast(kind === 'plan' ? 'ההחלטה נכנסה לתוכנית' : 'סגרנו: החלטתם לא לקנות');
    } catch (_err) { setBusy(false); showToast('לא נשמר. נסו שוב.'); }
  };

  return html`<${Sheet} title="מה החלטנו?" onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <span class="muted" style="font-size:14px">${d.title} · <b class="num">${money(d.amount)}</b>. ההחלטה תישמר על הכרטיס ובן/בת הזוג יקבלו עליה הודעה.</span>
      <div class="vote-choices" role="radiogroup" aria-label="ההחלטה">
        <button type="button" role="radio" aria-checked=${String(kind === 'plan')} class=${'vote-choice' + (kind === 'plan' ? ' on' : '')} style="--tone:var(--income)" onClick=${() => setKind('plan')}><span class="vote-icon">✅</span>קונים, נכנס לתוכנית</button>
        <button type="button" role="radio" aria-checked=${String(kind === 'decline')} class=${'vote-choice' + (kind === 'decline' ? ' on' : '')} style="--tone:var(--danger)" onClick=${() => setKind('decline')}><span class="vote-icon">🙅</span>החלטנו לא לקנות</button>
      </div>
      ${kind === 'plan' && html`<label class="field"><span>מתי</span><select class="input" value=${when} onChange=${(e) => setWhen(e.target.value)}>${months.map((m) => html`<option value=${m.value}>${m.label}</option>`)}</select></label>`}
      <label class="field"><span>מה סיכמנו (לא חובה)</span>
        <textarea class="input" rows="4" maxlength="1000" value=${summary} onInput=${(e) => setSummary(e.target.value)} placeholder="למשל: קונים בדצמבר מהבונוס. עד אז דני בודק מחירים, ונעמי מעבירה ₪300 בחודש לחיסכון."></textarea></label>
      ${aiOn && html`<button type="button" class="btn-text" style="align-self:flex-start" disabled=${drafting} onClick=${draft}>${drafting ? '✨ מנסח…' : '✨ שהיועץ ינסח מהשיחה'}</button>`}
      <button type="submit" class="btn" disabled=${!kind || busy}>${busy ? 'שומר…' : 'לסגור עם ההחלטה'}</button>
      ${dec && dec.partnerPush === 0 && html`<span class="hint">בן/בת הזוג עוד לא הפעילו התראות בטלפון, אז יראו את זה כשייכנסו לאפליקציה.</span>`}
    </form>
  <//>`;
}
