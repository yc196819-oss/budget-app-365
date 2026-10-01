import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { TOPICS, LESSONS } from '../../content/learning/index.js';
import { lessonOfDay, streak, complete, topicStats, shuffledQuiz } from '../../domain/learning.js';
import { saveProgress } from '../../data/learning.js';
import { showToast } from '../../lib/toast.js';
import { useLearning, setLearningCache } from './useLearning.js';

// The learning corner, separate from the advisor: one concept a day with a
// 2-question quiz, a streak, and the whole library by topic.
// view: 'today' | 'library' | lesson id
export function LearnSheet({ userId, householdId, onClose }) {
  const { progress } = useLearning(userId);
  const [view, setView] = useState('today');
  const day = lessonOfDay(LESSONS, progress);
  const s = streak(progress);
  const current = view === 'today' ? day.lesson : LESSONS.find((l) => l.id === view);

  const finish = async (lesson, answers) => {
    const next = complete(progress, lesson.id, answers);
    setLearningCache(next);
    try { await saveProgress(userId, householdId, next); } catch (_err) { showToast('ההתקדמות נשמרה במכשיר בלבד. היא תסתנכרן בפעם הבאה.'); }
  };

  return html`<${Sheet} title="פינת הלמידה" onClose=${onClose}>
    <div class="tabs" role="group" aria-label="תצוגה">
      <button type="button" aria-pressed=${String(view !== 'library')} onClick=${() => setView('today')}>השיעור של היום</button>
      <button type="button" aria-pressed=${String(view === 'library')} onClick=${() => setView('library')}>כל השיעורים</button>
    </div>
    ${view === 'library'
      ? html`<${Library} progress=${progress} onOpen=${setView} />`
      : html`<${Lesson} key=${current.id} lesson=${current} progress=${progress} streakDays=${s} isToday=${view === 'today'} onFinish=${finish}
          onNext=${() => setView(nextAfter(current.id, progress))} />`}
  <//>`;
}

function nextAfter(id, progress) {
  const i = LESSONS.findIndex((l) => l.id === id);
  const next = LESSONS.slice(i + 1).find((l) => !progress.done[l.id]) || LESSONS.find((l) => !progress.done[l.id]);
  return next ? next.id : 'library';
}

function Lesson({ lesson, progress, streakDays, isToday, onFinish, onNext }) {
  const quiz = shuffledQuiz(lesson);
  const wasDone = !!progress.done[lesson.id];
  const [step, setStep] = useState(wasDone ? 'done' : 'read'); // read | quiz | done
  const [answers, setAnswers] = useState([]);
  const q = quiz[answers.length];
  const pick = (i) => {
    const a = [...answers, i];
    setAnswers(a);
  };
  const lastAnswered = answers.length > 0 && answers.length <= quiz.length ? quiz[answers.length - 1] : null;
  const [showWhy, setShowWhy] = useState(false);
  const right = answers.filter((a, i) => a === quiz[i].answer).length;

  return html`<article class="lesson stack" style="gap:12px">
    <span class="muted" style="font-size:13px;font-weight:700">${lesson.icon} ${lesson.topicTitle} · חלק ${lesson.part} מתוך ${lesson.parts}${streakDays > 0 ? ' · 🔥 ' + streakDays + ' ימים ברצף' : ''}</span>
    <h3 class="lesson-title">${lesson.title}</h3>
    ${step === 'read' && html`
      ${lesson.body.map((p) => html`<p class="lesson-p">${p}</p>`)}
      <div class="lesson-take"><b>בשורה אחת</b><span>${lesson.takeaway}</span></div>
      <button type="button" class="btn" onClick=${() => setStep('quiz')}>למבחנון: 2 שאלות</button>`}
    ${step === 'quiz' && html`<div class="stack" style="gap:10px">
      ${lastAnswered && showWhy ? html`<div class=${'quiz-why ' + (answers[answers.length - 1] === lastAnswered.answer ? 'ok' : 'no')} role="status">
          <b>${answers[answers.length - 1] === lastAnswered.answer ? 'נכון!' : 'לא בדיוק. התשובה: ' + lastAnswered.options[lastAnswered.answer]}</b>
          <span>${lastAnswered.why}</span>
          <button type="button" class="btn" onClick=${() => {
            setShowWhy(false);
            if (answers.length === quiz.length) { onFinish(lesson, answers); setStep('done'); }
          }}>${answers.length === quiz.length ? 'לסיים את השיעור' : 'לשאלה הבאה'}</button>
        </div>`
      : q && html`<div class="stack" style="gap:8px">
          <span class="muted" style="font-size:12px">שאלה ${answers.length + 1} מתוך ${quiz.length}</span>
          <b style="font-size:16px">${q.q}</b>
          ${q.options.map((o, i) => html`<button type="button" class="quiz-opt" onClick=${() => { pick(i); setShowWhy(true); }}>${o}</button>`)}
        </div>`}
    </div>`}
    ${step === 'done' && html`<div class="stack" style="gap:10px">
      <div class="lesson-take done"><b>${wasDone && !answers.length ? 'השיעור הזה כבר הושלם' : right === quiz.length ? 'שתי תשובות נכונות!' : right + ' מתוך ' + quiz.length + ' נכונות'}</b>
        <span>${lesson.takeaway}</span></div>
      ${isToday && html`<span class="muted" style="font-size:14px;text-align:center">${streakDays > 0 ? '🔥 ' + streakDays + ' ימים ברצף. ' : ''}מחר מחכה מושג חדש.</span>`}
      <button type="button" class="btn btn-ghost" onClick=${onNext}>לשיעור הבא</button>
      ${wasDone && html`<button type="button" class="btn-text" onClick=${() => { setAnswers([]); setStep('read'); }}>לקרוא שוב</button>`}
    </div>`}
  </article>`;
}

function Library({ progress, onOpen }) {
  const stats = topicStats(TOPICS, progress);
  const [open, setOpen] = useState(null);
  return html`<div class="stack" style="gap:8px">
    <span class="muted" style="font-size:13px">${Object.keys(progress.done).length} מתוך ${LESSONS.length} שיעורים הושלמו</span>
    <div class="list">${stats.map((t) => html`<div class="topic" key=${t.id}>
      <button type="button" class="row" aria-expanded=${String(open === t.id)} onClick=${() => setOpen(open === t.id ? null : t.id)}>
        <span class="cat-icon" style="background:var(--surface-2)" aria-hidden="true">${t.icon}</span>
        <span class="row-main"><b>${t.title}</b><span>${t.done} מתוך ${t.total} שיעורים</span></span>
        <span class="bar" style="width:60px"><span style=${'width:' + Math.round((t.done / t.total) * 100) + '%;background:var(--accent)'}></span></span>
      </button>
      ${open === t.id && html`<div class="topic-lessons">${TOPICS.find((x) => x.id === t.id).lessons.map((l, i) => html`<button type="button" class="topic-lesson" onClick=${() => onOpen(l.id)}>
        <span class=${'tick' + (progress.done[l.id] ? ' on' : '')} aria-hidden="true">${progress.done[l.id] ? '✓' : i + 1}</span><span>${l.title}</span></button>`)}</div>`}
    </div>`)}</div>
  </div>`;
}
