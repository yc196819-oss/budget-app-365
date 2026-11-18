// A report of one advisor conversation: what it was about, what was
// decided, what is left to do. The AI writes the words; the amounts table
// keeps only amounts that are written in the conversation itself, so the
// report never shows a number nobody said.

const { convoText, parseLoose } = require('./learn');

function reportPrompt(today) {
  return [
    'אתה כותב דוח קצר על שיחה בין משק בית בישראל לבין יועץ כלכלי באפליקציית תקציב. היום ' + today + '.',
    'כתוב בעברית פשוטה, בגוף שלישי רבים ("שאלתם", "החלטתם"). בלי המלצות חדשות שלא עלו בשיחה, ובלי מספרים שלא נכתבו בה.',
    'ענה רק ב-JSON, בדיוק במבנה הזה:',
    '{"summary":"2-4 משפטים: על מה דיברתם ומה יצא מזה",',
    ' "decisions":["החלטה שהתקבלה בשיחה"],',
    ' "tasks":["משהו שנשאר לעשות"],',
    ' "amounts":[{"label":"למה הסכום מתייחס","amount":1200}]}',
    'עד 5 פריטים בכל רשימה. רשימה ריקה כשאין. amount הוא מספר בשקלים כפי שנכתב בשיחה.'
  ].join('\n');
}

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (a, n, len) => (Array.isArray(a) ? a : []).map((x) => clip(x, len)).filter(Boolean).slice(0, n);

// Every amount written in the conversation ("1,200", "₪8,000", "700").
function amountsIn(text) {
  const out = new Set();
  for (const m of String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []) {
    const v = Number(m.replace(/,/g, ''));
    if (Number.isFinite(v) && v > 0) out.add(Math.round(v));
  }
  return out;
}

function pickReport(parsed, convo) {
  if (!parsed || typeof parsed !== 'object') return null;
  const said = amountsIn(convo);
  const amounts = (Array.isArray(parsed.amounts) ? parsed.amounts : [])
    .map((a) => ({ label: clip(a && a.label, 80), amount: Math.round(Number(a && a.amount)) }))
    .filter((a) => a.label && Number.isFinite(a.amount) && a.amount > 0 && said.has(a.amount))
    .slice(0, 8);
  const summary = clip(parsed.summary, 700);
  if (!summary) return null;
  return { summary, decisions: list(parsed.decisions, 5, 160), tasks: list(parsed.tasks, 5, 160), amounts };
}

module.exports = { reportPrompt, pickReport, amountsIn, convoText, parseLoose };
