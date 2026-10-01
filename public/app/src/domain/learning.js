// Pure logic for the learning corner: lesson of the day, streak, quiz.
// Progress: { done: { [lessonId]: 'YYYY-MM-DD' }, answers: { [lessonId]: [i, j] } }

import { isoDate } from './money.js';

export function emptyProgress() {
  return { done: {}, answers: {} };
}

export function normalizeProgress(p) {
  const out = emptyProgress();
  if (p && typeof p === 'object') {
    if (p.done && typeof p.done === 'object') for (const [k, v] of Object.entries(p.done)) if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out.done[k] = v;
    if (p.answers && typeof p.answers === 'object') out.answers = { ...p.answers };
  }
  return out;
}

// One lesson a day: the lesson finished today (to show it as done), or the
// first one in teaching order that is not done yet.
export function lessonOfDay(lessons, progress, today = new Date()) {
  const t = isoDate(today);
  const doneToday = lessons.find((l) => progress.done[l.id] === t);
  if (doneToday) return { lesson: doneToday, doneToday: true };
  const next = lessons.find((l) => !progress.done[l.id]);
  return { lesson: next || lessons[lessons.length - 1], doneToday: false, allDone: !next };
}

// Days in a row with a finished lesson, ending today, or yesterday when
// today's lesson is not done yet (the streak is still alive).
export function streak(progress, today = new Date()) {
  const days = new Set(Object.values(progress.done));
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(isoDate(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(isoDate(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function complete(progress, lessonId, answers, today = new Date()) {
  return {
    done: { ...progress.done, [lessonId]: progress.done[lessonId] || isoDate(today) },
    answers: { ...progress.answers, [lessonId]: answers }
  };
}

export function topicStats(topics, progress) {
  return topics.map((t) => ({ id: t.id, title: t.title, icon: t.icon, total: t.lessons.length, done: t.lessons.filter((l) => progress.done[l.id]).length }));
}

// Quiz options in a stable shuffled order per lesson, so the right answer is
// not always in the same place (and does not move between visits).
function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
export function shuffledQuiz(lesson) {
  return lesson.quiz.map((q, qi) => {
    const rnd = seed(lesson.id + ':' + qi);
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return { q: q.q, why: q.why, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
  });
}
