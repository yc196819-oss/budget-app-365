// "What the advisor learned from this conversation": the prompt that asks
// the AI for concrete, approvable updates, and the parsing of its answer.
// The app checks every item again against the household's data and the
// person approves each one before anything is saved.

const KINDS = ['memory', 'goal', 'goal_update', 'budget', 'balance', 'loan', 'installment', 'income'];

function convoText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'ai') && m.text)
    .slice(-30)
    .map((m) => `${m.role === 'user' ? (m.author || 'משתמש') : 'יועץ'}: ${String(m.text).replace(/@@הצעות:.*$/s, '').slice(0, 1500)}`)
    .join('\n');
}

function learnPrompt(context, today) {
  return `אתה עוזר למשק בית בישראל לעדכן את האפליקציה שלו מתוך שיחה עם היועץ הפיננסי. היום: ${today}.
קרא את השיחה והצע רק עדכונים שבני הזוג עצמם אמרו או אישרו במפורש. לא עצות של היועץ שלא אושרו, לא ניחושים, לא רגשות רגעיים, לא פרטים רפואיים.
סוגי עדכונים (kind):
- memory: החלטה, העדפה קבועה או עובדה יציבה שכדאי לזכור לשיחות הבאות. {"kind":"memory","text":"משפט קצר עד 80 תווים","memKind":"decision|preference|goal|fact"}
- goal: יעד חיסכון חדש או הוצאה גדולה מתוכננת. {"kind":"goal","name":"...","target_amount":0,"saved_amount":0,"target_date":"YYYY-MM-DD או null"}
- goal_update: שינוי ביעד קיים (רק id מהרשימה). {"kind":"goal_update","goal_id":"...","set":{"target_amount":0,"saved_amount":0,"target_date":"YYYY-MM-DD"}} — כלול ב-set רק מה שמשתנה.
- budget: תקציב חודשי חדש לקטגוריה קיימת (רק שם מהרשימה). {"kind":"budget","category":"...","amount":0}
- balance: היתרה הנוכחית בחשבון בנק (רק id מהרשימה). {"kind":"balance","account_id":"...","balance":0}
- loan: הלוואה או חוב חדשים. {"kind":"loan","direction":"iowe|tome","counterparty":"...","amount":0}
- installment: קנייה בתשלומים. {"kind":"installment","description":"...","total_amount":0,"payments_count":0,"first_payment":"YYYY-MM-DD"}
- income: ההכנסה החודשית נטו הצפויה של משק הבית כולו. {"kind":"income","amount":0}
סכומים בש"ח, מספרים בלבד. אל תציע משהו שכבר קיים בנתונים או בזיכרונות. עד 10 פריטים. אם אין מה לעדכן — רשימה ריקה.
הנתונים הקיימים: ${JSON.stringify(context || {}).slice(0, 6000)}
ענה רק ב-JSON: {"items":[...]}`;
}

// The answer as JSON, even when wrapped in a code fence or a sentence.
function parseLoose(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (_e) { return null; }
}

function pickItems(parsed) {
  const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
  return items.filter((i) => i && typeof i === 'object' && KINDS.includes(i.kind)).slice(0, 15);
}

module.exports = { convoText, learnPrompt, parseLoose, pickItems, KINDS };
