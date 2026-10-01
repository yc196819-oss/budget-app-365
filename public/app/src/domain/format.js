// Pure formatting helpers. No DOM, no network: covered by tests/format.test.js.

const WEEKDAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// 1234.5 -> "₪1,235". The sign is handled by the caller (see signed()).
export function money(n) {
  const v = Math.abs(Math.round(Number(n) || 0));
  return '₪' + v.toLocaleString('en-US');
}

// Uses a real minus sign (U+2212) so it lines up with digits.
export function signed(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '−' : '+') + money(v);
}

// "שבת, 19 בספטמבר"
export function dateLabel(d) {
  return WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ב' + MONTHS[d.getMonth()];
}

export function greeting(d) {
  const h = d.getHours();
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

// Two letters for the avatar: from a display name ("יוסי ודני" -> "יד"),
// or from an email when there is no name.
export function initials(name, email) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1].replace(/^ו/, '')[0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const local = String(email || '').split('@')[0];
  return local ? local.slice(0, 2).toUpperCase() : '?';
}
