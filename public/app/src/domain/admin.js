// The owner dashboard's small calculations: the greeting, how long ago,
// where in the app people spend their actions, and the best day. Pure.

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני', 'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];

export function greeting(now = new Date()) {
  const h = now.getHours();
  const hello = h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
  return { hello, date: 'יום ' + DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()] };
}

export function ago(iso, now = new Date()) {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (min < 1) return 'עכשיו';
  if (min < 60) return 'לפני ' + min + ' דק׳';
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : 'לפני ' + h + ' שעות';
  return 'אתמול';
}

// Where people spend their actions (30 days), by part of the app.
const AREAS = [
  { key: 'money', label: 'כסף ותנועות', test: (n) => n === 'tx_add' || n.startsWith('import_') || n === 'export' || n === 'restore' },
  { key: 'advisor', label: 'יועץ', test: (n) => n.startsWith('advisor_') || n.startsWith('learn_') },
  { key: 'shop', label: 'קניות', test: (n) => n.startsWith('shop_') || n.startsWith('price_') },
  { key: 'goals', label: 'יעדים וביחד', test: (n) => n.startsWith('decision_') || n === 'trip_plan' },
  { key: 'learn', label: 'למידה וחדשות', test: (n) => n === 'lesson_done' || n === 'news_open' },
  { key: 'start', label: 'הרשמה והתחלה', test: (n) => n.startsWith('onboard_') || n.startsWith('guide_') || n === 'first_value' }
];
export function areas(use = []) {
  const m = new Map();
  for (const u of use) {
    const name = String(u.name || '');
    if (name === 'app_open') continue;
    const a = AREAS.find((x) => x.test(name));
    const key = a ? a.key : 'other';
    m.set(key, (m.get(key) || 0) + (Number(u.count) || 0));
  }
  const total = [...m.values()].reduce((s, n) => s + n, 0);
  if (!total) return [];
  return [...m.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({
    key, label: key === 'other' ? 'אחר' : AREAS.find((x) => x.key === key).label, n, pct: Math.round((n / total) * 100)
  }));
}

// Today the busiest day of the month (or, failing that, of two weeks).
export function record(daily = []) {
  if (daily.length < 7) return null;
  const today = daily[daily.length - 1].active;
  if (!(today > 0)) return null;
  const beats = (days) => days.length > 1 && today > Math.max(...days.slice(0, -1).map((d) => d.active));
  if (daily.length >= 28 && beats(daily.slice(-30))) return { today, span: 'month' };
  if (beats(daily.slice(-14))) return { today, span: 'twoWeeks' };
  return null;
}
