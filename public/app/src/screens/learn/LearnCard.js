import { html } from '../../lib/html.js';
import { LESSONS } from '../../content/learning/index.js';
import { lessonOfDay, streak } from '../../domain/learning.js';
import { useLearning } from './useLearning.js';

// Home: today's lesson, with the streak.
export function LearnCard({ userId, onOpen }) {
  const { progress } = useLearning(userId);
  const { lesson, doneToday, allDone } = lessonOfDay(LESSONS, progress);
  const s = streak(progress);
  const done = Object.keys(progress.done).length;
  return html`<button type="button" class="card learn-card" onClick=${onOpen}>
    <span class="learn-icon" aria-hidden="true">📚</span>
    <span class="plan-main">
      <small>פינת הלמידה · ${doneToday ? 'השיעור של היום הושלם' : allDone ? 'סיימתם את כל השיעורים' : 'המושג של היום'}
        ${s > 0 && html`<span class="flame" title="ימים ברצף">🔥 ${s}</span>`}</small>
      <b>${lesson.title}</b>
      <span>${lesson.topicTitle} · חלק ${lesson.part} מתוך ${lesson.parts} · ${done} מתוך ${LESSONS.length} שיעורים</span>
    </span>
  </button>`;
}
