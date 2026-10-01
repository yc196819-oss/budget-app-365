import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { listMemories, addMemory, updateMemory, deleteMemory } from '../../data/learn.js';
import { showToast } from '../../lib/toast.js';

// "What the advisor knows about us": the decisions and facts it takes into
// account in every answer, shared by the household. Edit, delete or add.
export function MemoriesView({ hid, userId, onBack }) {
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [edits, setEdits] = useState({});

  const load = () => listMemories(hid).then((l) => { setList(l); setFailed(false); }).catch(() => setFailed(true));
  useEffect(() => { load(); }, [hid]);

  const add = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (text.length < 2) return;
    try { const row = await addMemory({ hid, userId, text }); setList((l) => [row, ...(l || [])]); setDraft(''); } catch (_err) { showToast('לא נשמר. נסו שוב.'); }
  };
  const save = async (m) => {
    const text = (edits[m.id] ?? m.text).trim();
    if (!text || text === m.text) return;
    try { await updateMemory(m.id, hid, text); setList((l) => l.map((x) => (x.id === m.id ? { ...x, text } : x))); showToast('עודכן'); } catch (_err) { showToast('לא נשמר. נסו שוב.'); }
  };
  const remove = async (m) => {
    try { await deleteMemory(m.id, hid); setList((l) => l.filter((x) => x.id !== m.id)); showToast('נמחק'); } catch (_err) { showToast('המחיקה נכשלה. נסו שוב.'); }
  };

  return html`<div class="stack memories">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>‹ חזרה</button>
    <span class="muted" style="font-size:13px;line-height:1.5">היועץ מתחשב בכל אלה בכל תשובה, אצל שניכם. נוסף לכאן מה שאישרתם ב"מה למדתי" בשיחות.</span>
    <form class="mem-row" onSubmit=${add}>
      <input class="input" value=${draft} maxlength="120" onInput=${(e) => setDraft(e.target.value)} placeholder="למשל: לא לוקחים הלוואות לחופשות" aria-label="דבר חדש שהיועץ יזכור" />
      <button type="submit" class="btn" style="flex:none" disabled=${draft.trim().length < 2}>להוסיף</button>
    </form>
    ${list === null && !failed && html`<div class="skel-row"><span class="skel" style="width:70%"></span><span class="skel" style="width:50%"></span></div>`}
    ${failed && html`<span class="muted">לא הצלחנו לטעון. <button type="button" class="btn-text" onClick=${load}>לנסות שוב</button></span>`}
    ${list && list.length === 0 && html`<span class="muted" style="font-size:14px">עוד אין כאן כלום. ספרו ליועץ על החלטות ויעדים, ולחצו "מה למדתי".</span>`}
    ${list && list.map((m) => html`<div class="mem-row mem-item" key=${m.id}>
      <input class="input" value=${edits[m.id] ?? m.text} maxlength="120" aria-label="זיכרון" onInput=${(e) => setEdits({ ...edits, [m.id]: e.target.value })} onBlur=${() => save(m)} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      <button type="button" class="icon-btn" style="width:36px;height:36px;color:var(--danger)" aria-label=${'למחוק: ' + m.text} onClick=${() => remove(m)}>✕</button>
    </div>`)}
  </div>`;
}
