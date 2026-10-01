import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, LESSONS } from '../public/app/src/content/learning/index.js';
import { emptyProgress, normalizeProgress, lessonOfDay, streak, complete, topicStats, shuffledQuiz } from '../public/app/src/domain/learning.js';

test('the library: at least 100 lessons, several per topic, each complete', () => {
  assert.ok(LESSONS.length >= 100, 'lessons: ' + LESSONS.length);
  assert.ok(TOPICS.length >= 10);
  const ids = new Set();
  for (const t of TOPICS) assert.ok(t.lessons.length >= 5, t.id + ' has few lessons');
  for (const l of LESSONS) {
    assert.ok(!ids.has(l.id), 'duplicate id ' + l.id);
    ids.add(l.id);
    assert.ok(l.title && l.takeaway, l.id);
    assert.ok(l.body.length >= 2 && l.body.every((p) => p.length > 40), l.id + ' body too short');
    assert.equal(l.quiz.length, 2, l.id);
    for (const q of l.quiz) {
      assert.ok(q.q && q.why, l.id);
      assert.ok(q.options.length >= 2 && q.options.length <= 4, l.id);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, l.id + ' answer index');
      assert.equal(new Set(q.options).size, q.options.length, l.id + ' duplicate options');
    }
  }
});

const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

test('lesson of the day: the next one not done, or the one done today', () => {
  const p = emptyProgress();
  assert.equal(lessonOfDay(LESSONS, p, D('2026-10-05')).lesson.id, LESSONS[0].id);
  const p2 = complete(p, LESSONS[0].id, [0, 1], D('2026-10-05'));
  assert.deepEqual(lessonOfDay(LESSONS, p2, D('2026-10-05')), { lesson: LESSONS[0], doneToday: true });
  assert.equal(lessonOfDay(LESSONS, p2, D('2026-10-06')).lesson.id, LESSONS[1].id);
  const all = { done: Object.fromEntries(LESSONS.map((l) => [l.id, '2026-01-01'])), answers: {} };
  assert.equal(lessonOfDay(LESSONS, all, D('2026-10-06')).allDone, true);
});

test('streak: days in a row, alive until the end of the next day', () => {
  let p = emptyProgress();
  p = complete(p, 'a', [], D('2026-10-03'));
  p = complete(p, 'b', [], D('2026-10-04'));
  p = complete(p, 'c', [], D('2026-10-05'));
  assert.equal(streak(p, D('2026-10-05')), 3);
  assert.equal(streak(p, D('2026-10-06')), 3);
  assert.equal(streak(p, D('2026-10-07')), 0);
  assert.equal(streak(emptyProgress(), D('2026-10-07')), 0);
  // Redoing a lesson keeps its first date.
  assert.equal(complete(p, 'a', [1], D('2026-10-09')).done.a, '2026-10-03');
});

test('progress from storage is cleaned', () => {
  assert.deepEqual(normalizeProgress(null), emptyProgress());
  assert.deepEqual(normalizeProgress({ done: { a: '2026-10-01', b: 'bad' }, answers: { a: [1, 0] } }), { done: { a: '2026-10-01' }, answers: { a: [1, 0] } });
});

test('topic stats', () => {
  const p = complete(emptyProgress(), TOPICS[0].lessons[0].id, [], D('2026-10-05'));
  const s = topicStats(TOPICS, p);
  assert.equal(s[0].done, 1);
  assert.equal(s[0].total, TOPICS[0].lessons.length);
});

test('quiz options are shuffled, stable per lesson, and keep the right answer', () => {
  let moved = 0;
  for (const l of LESSONS) {
    const a = shuffledQuiz(l);
    const b = shuffledQuiz(l);
    assert.deepEqual(a, b);
    a.forEach((q, i) => {
      assert.equal(q.options[q.answer], l.quiz[i].options[l.quiz[i].answer]);
      assert.deepEqual([...q.options].sort(), [...l.quiz[i].options].sort());
      if (q.answer !== l.quiz[i].answer) moved++;
    });
  }
  assert.ok(moved > LESSONS.length / 2, 'answers should not stay in place');
});
