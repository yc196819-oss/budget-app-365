// "What the advisor learned from this conversation": the prompt that asks
// the AI for concrete, approvable updates, and the parsing of its answer.
// The app checks every item again against the household's data, then
// applies it and shows it with undo (or asks first, if the person chose so).

const KINDS = ['memory', 'goal', 'goal_update', 'budget', 'balance', 'loan', 'installment', 'income', 'tx_delete'];

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
- installment: קנייה בתשלומים, וגם תשלום קבוע למספר ידוע של חודשים (למשל "החוג 1,380 ל-3 החודשים הקרובים": total_amount = 1380×3, payments_count = 3, first_payment = תאריך החיוב הבא). {"kind":"installment","description":"...","total_amount":0,"payments_count":0,"first_payment":"YYYY-MM-DD"} — מה שנשמר כך לא נשמר גם כ-memory.
- tx_delete: רק כשהמשתמש עצמו ביקש במפורש למחוק תנועות מסוימות (טעות, כפילות), לעולם לא כי היועץ חשד בטעות. פריט אחד לכל סוג תנועה, לפי מה שהמשתמש אמר (האפליקציה מוצאת את התנועות עצמן ומציגה אותן לאישור; אם אין כזו, לא יקרה כלום): {"kind":"tx_delete","match":"חלק משם בית העסק כפי שהמשתמש כתב","amount":0,"date":"YYYY-MM-DD או null","reason":"קצר"}. המחיקה תוצג לאישור, לא תתבצע לבד.
- income: הכנסה חודשית נטו צפויה של אחד מבני הבית או של מקור אחד (למשל משכורת של אחד מהם). {"kind":"income","label":"משכורת <שם>","amount":0} — שורה אחת לכל אדם או מקור; אם יש כבר שורה שלו ברשימת income, השתמש באותו label. לעולם אל תכתוב סכום של אדם אחד כאילו הוא ההכנסה של כל משק הבית.
- balance: גם כשמספרים על העברה בין חשבונות או חיוב שירד, עדכן את היתרה החדשה של כל חשבון שהשתנה (לפי היתרה הקודמת ברשימה ומה שסופר).
אם בהודעה האחרונה כתוב לא לעדכן (למשל "אל תעדכן", "לא לעדכן", "רק שאלה"), החזר רשימה ריקה.
סכומים בש"ח, מספרים בלבד. אל תציע משהו שכבר קיים בנתונים או בזיכרונות. עד 10 פריטים. אם אין מה לעדכן — רשימה ריקה.
הנתונים הקיימים: ${JSON.stringify(context || {}).slice(0, 9000)}
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
