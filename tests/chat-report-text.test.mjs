import test from 'node:test';
import assert from 'node:assert/strict';
import { reportText, reportMessages } from '../public/app/src/domain/chatReport.js';

test('chat report text: sections only when they have something, amounts in shekels', () => {
  const t = reportText({ title: 'תכנון לשנה הבאה', when: '18.11.2026', report: { summary: 'דיברתם על הרכב.', decisions: ['רכב 700 בחודש'], tasks: [], amounts: [{ label: 'תקציב רכב', amount: 700 }] }, changes: ['תקציב רכב: ₪700 (היה ₪900)'] });
  assert.match(t, /^דוח על השיחה: תכנון לשנה הבאה\n18\.11\.2026\n\nבקצרה\nדיברתם על הרכב\./);
  assert.match(t, /מה החלטתם\n• רכב 700 בחודש/);
  assert.doesNotMatch(t, /מה נשאר לעשות/);
  assert.match(t, /סכומים שעלו בשיחה\n• תקציב רכב: ₪700/);
  assert.match(t, /מה עודכן באפליקציה\n• תקציב רכב: ₪700 \(היה ₪900\)/);
});

test('chat report: made from the questions and answers, not a stopped question or a quick guide answer', () => {
  const m = reportMessages([
    { role: 'user', text: 'א', author_id: 'u1' }, { role: 'ai', text: 'ב' },
    { role: 'user', text: 'נעצרה', author_id: 'u1', stopped: true },
    { role: 'user', text: 'איך מעלים?', local: true }, { role: 'ai', text: 'מהמדריך', local: true },
    { role: 'ai', text: '', pending: true }
  ], () => 'יוסי');
  assert.deepEqual(m, [{ role: 'user', text: 'א', author: 'יוסי' }, { role: 'ai', text: 'ב', author: undefined }]);
});
