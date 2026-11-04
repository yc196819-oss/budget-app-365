import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOWTO, GO_TARGETS, matchHowto, guideText } from '../public/app/src/content/howto.js';
import { parseGo, OVERLAYS } from '../public/app/src/lib/go.js';
import { TABS } from '../public/app/src/domain/routes.js';

test('every entry has a question, steps and a real place to go', () => {
  const ids = new Set();
  for (const e of HOWTO) {
    assert.ok(e.id && !ids.has(e.id), 'unique id ' + e.id); ids.add(e.id);
    assert.ok(e.q.length > 5 && e.a.length > 20, e.id);
    assert.ok(e.keys.length >= 1 && e.keys.every((g) => g.length > 0), e.id);
    if (e.go) {
      assert.ok(GO_TARGETS[e.go], e.id + ' goes to ' + e.go);
      assert.ok(e.cta, e.id + ' has a button');
    }
  }
  // Every target is a tab or a sheet the shell knows.
  for (const t of Object.keys(GO_TARGETS)) {
    const g = parseGo(t);
    if (g.overlay) assert.ok(OVERLAYS.includes(g.overlay), t);
    else assert.ok(TABS.some((x) => g.hash.startsWith('#/' + x.key)), t);
  }
});

test('"how do I…" questions about the app are answered from the guide', () => {
  const cases = {
    'איך מוחקים קטגוריה?': 'cat-delete',
    'איך מוחקים תת קטגוריה': 'cat-delete',
    'איך משנים שם לקטגוריה': 'cat-rename',
    'איך מוסיפים קטגוריה חדשה': 'cat-add',
    'איך משנים קטגוריה לתנועה': 'tx-category',
    'איך אני מעלה פירוט של כרטיס אשראי': 'import',
    'איך מעלים קובץ אקסל': 'import',
    'איך מורידים את הפירוט מכאל': 'download',
    'איך מוסיפים הוצאה': 'add',
    'איך מוחקים תנועה': 'tx-delete',
    'איך מתקנים סכום של הוצאה': 'tx-edit',
    'איך מחפשים תנועה של סופר': 'search',
    'איפה רואים דוח שנתי': 'report',
    'איפה אני רואה תחזית': 'forecast',
    'איך קובעים תקציב לאוכל': 'budget',
    'איך מתכננים טיול לאילת': 'trips',
    'איך מזמינים את אשתי': 'invite',
    'איך אני מוסיף את בעלי': 'invite',
    'איך משנים את הסף של ההחלטות ביחד': 'agreement',
    'איך מוסיפים חשבון בנק נוסף': 'account',
    'איך מוסיפים כרטיס אשראי': 'card',
    'איך אני רושם הלוואה': 'loan',
    'איך מורידים את כל המידע': 'export',
    'מחקתי בטעות תנועה, איך מחזירים?': 'restore',
    'איך מפעילים התראות': 'push',
    'איך מכבים את היועץ': 'ai-off',
    'איך עושים שיחה פרטית': 'private-chat',
    'איך מפעילים קוד אימות': 'security',
    'איך מתקינים את האפליקציה': 'install',
    'איפה רואים חודש קודם': 'months'
  };
  for (const [q, id] of Object.entries(cases)) {
    const hit = matchHowto(q);
    assert.equal(hit && hit.id, id, q);
  }
});

test('questions about the money itself still go to the advisor', () => {
  const advisor = [
    'איך לחסוך יותר כסף?', 'איך אפשר לחסוך באוכל?', 'כמה הוצאנו החודש על סופר?', 'האם כדאי לי לקנות רכב',
    'מה כדאי לעשות עם הבונוס?', 'איך אני יכול להוריד את ההוצאות על מסעדות', 'איך לבנות תקציב נכון?',
    'איך להחזיר את המינוס', 'איך מגדילים את החיסכון', 'אפשר לקנות מכונת כביסה החודש?', 'איך להוריד את המשכנתא',
    'צריך לבטל מנויים?', 'איך מתמודדים עם חובות', 'איך לחסוך לטיול', 'איך לנהל כסף עם בן הזוג', 'רוצה לחסוך 1000 בחודש',
    'איך משקיעים בקרן מחקה מדד', 'איך מתכננים פנסיה', 'איזה כרטיס אשראי הכי משתלם', 'צריך לקחת הלוואה לרכב?',
    'אפשר לדעת כמה נשאר לנו החודש?', 'לאן הלך הכסף החודש?', 'איך התחזית שלנו?', 'איך למצוא דרכים לחסוך בהוצאות',
    'החלטנו לחסוך 1,000 בחודש', 'המשכורת שלי עלתה ל-12,500', 'מה המצב?', 'תודה'
  ];
  // The suggested questions on every screen too.
  const starters = ['כמה אני יכול להוציא היום?', 'למה החודש יקר יותר?', 'מה הכי דחוף לטפל בו?', 'איפה אפשר לקצץ החודש?', 'מה השתנה לעומת החודש שעבר?', 'יש מנויים שכדאי לבטל?',
    'אפשר להרשות את מה שמחכה לאישור?', 'מה הכי חשוב לקנות קודם?', 'איך מחליטים בלי לריב?', 'היעדים שלנו ריאליים?', 'איך סוגרים את הפער החודשי?', 'כמה לחסוך לחגים?',
    'כדאי להחזיר הלוואה מוקדם?', 'דמי הניהול שלנו סבירים?', 'כמה כסף לשמור בעו״ש?'];
  for (const q of [...advisor, ...starters]) assert.equal(matchHowto(q), null, q);
});

test('the guide for the advisor covers every screen, every answer, and what the app cannot do', () => {
  const t = guideText();
  for (const tab of TABS) assert.ok(t.includes(tab.label), tab.label);
  for (const e of HOWTO) assert.ok(t.includes(e.q) && t.includes(e.a), e.id);
  assert.match(t, /מה אין כרגע/);
  assert.match(t, /אין חיבור ישיר לבנק/);
});

test('go targets: a sheet with its inner view, or a tab with its view', () => {
  assert.deepEqual(parseGo('profile/data'), { overlay: 'profile', view: 'data' });
  assert.deepEqual(parseGo('import'), { overlay: 'import', view: '' });
  assert.deepEqual(parseGo('money/manage'), { hash: '#/money/manage' });
  assert.deepEqual(parseGo('plans'), { hash: '#/plans' });
});

import { sortInbox, filterInbox } from '../public/app/src/domain/inbox.js';
test('the inbox: pinned, then unread, then newest; filters and search', () => {
  const m = (t) => [{ author: 'user', text: t }];
  const items = [
    { id: 'a', who: 'רון', kind: 'bug', unread: 0, pinned: false, archived: false, closed: true, last_at: '2026-11-03', messages: m('ישן') },
    { id: 'b', who: 'נועה', kind: 'idea', unread: 1, pinned: false, archived: false, closed: false, last_at: '2026-11-01', messages: m('רעיון') },
    { id: 'c', who: 'דני', kind: 'bug', unread: 0, pinned: true, archived: false, closed: false, last_at: '2026-10-01', messages: m('נתקע') },
    { id: 'd', who: 'אבי', kind: 'other', unread: 0, pinned: false, archived: true, closed: true, last_at: '2026-11-04', messages: m('תודה') }
  ];
  assert.deepEqual(sortInbox(filterInbox(items, 'all')).map((x) => x.id), ['c', 'b', 'a']);
  assert.deepEqual(filterInbox(items, 'unread').map((x) => x.id), ['b']);
  assert.deepEqual(filterInbox(items, 'open').map((x) => x.id), ['b', 'c']);
  assert.deepEqual(filterInbox(items, 'archived').map((x) => x.id), ['d']);
  assert.deepEqual(filterInbox(items, 'all', 'נתקע').map((x) => x.id), ['c']);
  assert.deepEqual(filterInbox(items, 'all', 'נועה').map((x) => x.id), ['b']);
});

import { todaySummary, healthCounts } from '../public/app/src/domain/people-health.js';
test('one sentence about today for the owner', () => {
  assert.equal(todaySummary([]), 'היום עוד אף אחד לא נכנס (חוץ ממך).');
  const s = todaySummary([
    { name: 'רון', imports: 2, asked: 3, cost: 0.4, health: { level: 'good', label: 'משתמש פעיל' } },
    { name: 'נועה', newToday: true, importFails: 1, cost: 0, health: { level: 'stuck', label: 'לא העלה אף פירוט' } }
  ]);
  assert.match(s, /היום נכנסו 2 משתמשים \(אחד חדש\)\./);
  assert.match(s, /אחד העלה פירוט/);
  assert.match(s, /עלות AI היום \$0\.40/);
  assert.match(s, /נתקלו בתקלה: נועה/);
  assert.match(s, /כדאי לעזור ל: נועה \(לא העלה אף פירוט\)/);
  assert.deepEqual(healthCounts([{ health: { level: 'good' } }, { health: { level: 'stuck' } }, { health: { level: 'stuck' } }]), { good: 1, watch: 0, stuck: 2, gone: 0 });
});

import { profileHint } from '../public/app/src/content/howto.js';
test('where the profile is, on a phone and on a computer', () => {
  assert.match(profileHint('פרופיל ← "המידע שלנו"', false), /בטלפון: הפרופיל בעיגול עם האותיות בפינה העליונה/);
  assert.match(profileHint('פרופיל ← "המידע שלנו"', true), /במחשב: הפרופיל בכפתור עם השם בתחתית התפריט שבצד/);
  assert.equal(profileHint('כסף ← "קטגוריות"', true), '');
  const t = guideText();
  assert.match(t, /בטלפון העיגול עם האותיות בפינה העליונה, במחשב הכפתור עם השם בתחתית התפריט שבצד/);
  assert.match(t, /כתבו לנו/);
  assert.match(t, /ספר לחבריך/);
});
