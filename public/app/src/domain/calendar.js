// Holidays and quarters, for planning ahead. Pure.

import { isoDate, parseDate, monthShare } from './money.js';

// First day of each holiday (Gregorian). The holidays that cost a family
// noticeably more than a regular month.
const HOLIDAY_DATES = {
  pesach: ['2025-04-13', '2026-04-02', '2027-04-22', '2028-04-11', '2029-03-31'],
  shavuot: ['2025-06-02', '2026-05-22', '2027-06-11', '2028-05-31', '2029-05-20'],
  roshHashana: ['2025-09-23', '2026-09-12', '2027-10-02', '2028-09-21', '2029-09-10'],
  sukkot: ['2025-10-07', '2026-09-26', '2027-10-16', '2028-10-05', '2029-09-24'],
  chanukah: ['2025-12-15', '2026-12-05', '2027-12-25', '2028-12-13', '2029-12-02']
};

export const HOLIDAYS = {
  pesach: { name: 'פסח', items: [['food', 'אוכל ואירוח לחג', 1200, true], ['clean', 'ניקיון וכלים', 300, true], ['clothes', 'בגדים לחג', 600, true], ['trips', 'טיולים בחול המועד', 800, true], ['gifts', 'מתנות', 300, false]] },
  shavuot: { name: 'שבועות', items: [['food', 'אוכל ואירוח לחג', 500, true], ['trips', 'טיול או בילוי', 300, false]] },
  roshHashana: { name: 'ראש השנה', items: [['food', 'אוכל ואירוח לחג', 900, true], ['gifts', 'מתנות לחג', 400, true], ['clothes', 'בגדים לחג', 400, false]] },
  sukkot: { name: 'סוכות', items: [['lulav', 'ארבעת המינים', 150, true], ['sukka', 'סוכה וקישוטים', 350, true], ['food', 'אוכל ואירוח לחג', 900, true], ['trips', 'טיולים ובילויים בחול המועד', 700, true], ['gifts', 'בגדים ומתנות לחג', 400, false]] },
  chanukah: { name: 'חנוכה', items: [['gifts', 'מתנות לילדים', 400, true], ['food', 'סופגניות ואירוח', 200, true], ['trips', 'בילויים בחופשה', 500, true]] }
};

const dayDiff = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
const toDate = (iso) => { const d = parseDate(iso); return new Date(d.y, d.m, d.d); };

// Every holiday occurrence between two dates: [{ key, name, date }]
export function holidaysBetween(from, to) {
  const a = isoDate(from);
  const b = isoDate(to);
  const out = [];
  for (const [key, dates] of Object.entries(HOLIDAY_DATES)) {
    for (const date of dates) if (date >= a && date <= b) out.push({ key, name: HOLIDAYS[key].name, date });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : 1));
}

// The next holiday starting within `days` days (today included).
export function nextHoliday(today, days = 21) {
  const h = holidaysBetween(today, new Date(today.getFullYear(), today.getMonth(), today.getDate() + days))[0];
  return h ? { ...h, inDays: dayDiff(today, toDate(h.date)), year: toDate(h.date).getFullYear() } : null;
}

export function previousOccurrence(key, date) {
  return [...HOLIDAY_DATES[key]].reverse().find((d) => d < date) || null;
}

// How much more than a regular month the holiday's month cost last time:
// that month's spending minus the average of the 6 months before it.
// null when there is not enough history.
export function lastHolidayExtra(key, date, txs) {
  const prev = previousOccurrence(key, date);
  if (!prev) return null;
  const p = parseDate(prev);
  const spentIn = (y, m) => txs.reduce((s, t) => s + (t.type === 'income' ? 0 : monthShare(t, { y, m })), 0);
  const holidayMonth = spentIn(p.y, p.m);
  const before = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(p.y, p.m - i, 1);
    const v = spentIn(d.getFullYear(), d.getMonth());
    if (v > 0) before.push(v);
  }
  if (!holidayMonth || before.length < 3) return null;
  const avg = before.reduce((s, v) => s + v, 0) / before.length;
  return Math.max(0, Math.round((holidayMonth - avg) / 50) * 50);
}

export function holidayGoalName(holiday) {
  return HOLIDAYS[holiday.key].name + ' ' + toDate(holiday.date).getFullYear();
}

export function defaultHolidayItems(key) {
  return HOLIDAYS[key].items.map(([id, name, amount, on]) => ({ id, name, amount, on }));
}

// ── quarters ───────────────────────────────────────────────────────────

export function quarterOf(date) {
  const q = Math.floor(date.getMonth() / 3);
  return { id: date.getFullYear() + '-Q' + (q + 1), months: [0, 1, 2].map((i) => ({ y: date.getFullYear(), m: q * 3 + i })) };
}

// The check-in shows during the first three weeks of a quarter, until answered.
export function checkinDue(today, doneId) {
  const q = quarterOf(today);
  const firstMonth = today.getMonth() % 3 === 0;
  return firstMonth && today.getDate() <= 21 && doneId !== q.id;
}

export const CHECKIN_KINDS = [
  { key: 'car', label: 'טיפול או תיקון ברכב', icon: '🚗' },
  { key: 'home', label: 'מוצר לבית', icon: '🛋️' },
  { key: 'event', label: 'אירוע משפחתי', icon: '🎉' },
  { key: 'health', label: 'טיפול רפואי או שיניים', icon: '🩺' },
  { key: 'study', label: 'לימודים או קורס', icon: '📚' },
  { key: 'other', label: 'משהו אחר', icon: '📌' }
];
