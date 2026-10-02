// What people say when adding money by voice ("שילמתי שמונים שקל בסופר",
// "קיבלתי משכורת 21 אלף") turned into an amount, a description and
// expense/income. Works for typed text and keyboard dictation too. Pure.

const UNITS = {
  'אחד': 1, 'אחת': 1, 'שניים': 2, 'שתיים': 2, 'שני': 2, 'שתי': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4,
  'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9, 'עשר': 10, 'עשרה': 10
};
const TEENS = { 'אחת עשרה': 11, 'אחד עשר': 11, 'שתים עשרה': 12, 'שנים עשר': 12, 'חמש עשרה': 15, 'חמישה עשר': 15 };
const TENS = { 'עשרים': 20, 'שלושים': 30, 'ארבעים': 40, 'חמישים': 50, 'שישים': 60, 'שבעים': 70, 'שמונים': 80, 'תשעים': 90 };
const HUNDREDS = { 'מאה': 100, 'מאתיים': 200, 'שלוש מאות': 300, 'ארבע מאות': 400, 'חמש מאות': 500, 'שש מאות': 600, 'שבע מאות': 700, 'שמונה מאות': 800, 'תשע מאות': 900 };
const THOUSANDS = { 'אלף': 1000, 'אלפיים': 2000, 'שלושת אלפים': 3000, 'ארבעת אלפים': 4000, 'חמשת אלפים': 5000, 'ששת אלפים': 6000, 'שבעת אלפים': 7000, 'שמונת אלפים': 8000, 'תשעת אלפים': 9000, 'עשרת אלפים': 10000 };

// Word phrases, longest first, so "שלוש מאות" wins over "שלוש".
const PHRASES = Object.entries({ ...THOUSANDS, ...HUNDREDS, ...TEENS, ...TENS, ...UNITS }).sort((a, b) => b[0].length - a[0].length);

const INCOME = /(קיבלתי|קיבלנו|נכנס|נכנסה|נכנסו|הכנסה|משכורת|שכר|החזר|זיכוי|בונוס|מתנה שקיבל|העבירו לי|העבירו לנו)/;
const FILLER = /(^|\s)(שילמתי|שילמנו|קניתי|קנינו|הוצאתי|הוצאנו|עלה לי|עלה לנו|עלתה לי|קיבלתי|קיבלנו|נכנס לי|נכנס לנו|נכנסו|נכנסה|נכנס|תוסיף|תוסיפי|להוסיף|הוסף|תרשום|תרשמי|לרשום|בערך|בסך הכל|רק)(?=\s|$)/g;
const CURRENCY = /(שקלים|שקל|ש"ח|ש״ח|שח|₪|nis)/gi;

// Hebrew number words → digits, inside the text ("מאה וחמישים" → "150",
// "21 אלף" → "21000", "אלף וחמש מאות" → "1500").
export function wordsToNumbers(text) {
  let s = ' ' + String(text || '').replace(/\s+/g, ' ') + ' ';
  // "21 אלף" / "2.5 אלף"
  s = s.replace(/(\d+(?:\.\d+)?)\s*(אלף|אלפים)(?=\s)/g, (_m, n) => String(Math.round(Number(n) * 1000)));
  // A run of number words joined by "ו" ("מאה ושלושים וחמש"), maybe with a
  // preposition in front ("במאתיים" → "250" for "for two hundred").
  const word = PHRASES.map(([w]) => w.replace(/ /g, '\\s')).join('|');
  const run = new RegExp(`(^|\\s)[בל]?((?:ו?(?:${word}))(?:\\s(?:ו?(?:${word})))*)(?=\\s)`, 'g');
  s = s.replace(run, (_m, pre, phrase) => {
    let total = 0;
    let rest = phrase;
    while (rest) {
      rest = rest.replace(/^\s*ו?/, '');
      const hit = PHRASES.find(([w]) => rest.startsWith(w));
      if (!hit) break;
      total += hit[1];
      rest = rest.slice(hit[0].length);
    }
    return total ? pre + total : pre + phrase;
  });
  return s.trim();
}

// { amount, description, type: 'expense'|'income' } or null when there is no amount.
export function parseSpoken(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const type = INCOME.test(raw) ? 'income' : 'expense';
  let s = wordsToNumbers(raw);
  const m = s.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
  if (!(amount > 0)) return null;
  s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
  // "80 שקל בסופר" / "שקל על דלק": the place after the currency loses its preposition.
  s = s.replace(/(?:שקלים|שקל|ש"ח|ש״ח|שח|₪)\s+(?:על\s+|ב(?=\S{2,})|ל(?=\S{2,}))/g, ' ');
  const description = s.replace(CURRENCY, ' ').replace(FILLER, ' ').replace(/^\s*(על|ב|ל)\s+/, ' ').replace(/[.,!?]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!description) return null;
  return { amount, description, type };
}
