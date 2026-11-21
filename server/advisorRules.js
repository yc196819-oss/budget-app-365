// Rules for the advisor about numbers the person gives in the conversation,
// and how the conversation is sent to the AI. Kept apart so they can be
// tested.

// When the person tells their own figures (balances, card charges not taken
// yet, bills, salaries) and asks what is left, the advisor calculates with
// them, line by line, and only then compares with the app's forecast. Before
// this, two rules ("do not calculate yourself" and "use only the forecast")
// left it answering "the only number I have is the forecast".
// A balance (income, expenses, what is left) is shown by the app as a card,
// with the totals added up on the device: the AI writes the lines only.
const BALANCE_RULE = `מאזן ככרטיס: כששואלים כמה נכנס, כמה יוצא או כמה יישאר, כתוב רק משפט או שניים, ואז בשורה נפרדת @@מאזן: ו-JSON בשורה אחת:
{"title":"...","start":[{"label":"...","amount":-1200}],"income":[{"label":"...","amount":0}],"expenses":[{"label":"...","amount":0}],"note":"..."}
start (יתרות, עם סימן) רק אם ביקשו לכלול. סכומים חיוביים ב-income/expenses, בלי סכומים כוללים (האפליקציה מחברת). מה שאמרו לא לספור: ב-note. לפני @@הצעות:.`;

const OWN_NUMBERS_RULE = `מספרים שהמשתמש מסר: כשהמשתמש כותב נתונים משלו (יתרות בחשבונות, חיובי אשראי שעוד לא ירדו, חשבונות שעומדים לרדת, משכורות והכנסות שעוד ייכנסו) ושואל כמה יישאר, מה המאזן או אם יספיק, חשב עם המספרים שלו. זה החישוב היחיד שמותר לך לעשות בעצמך:
1. הצג את החישוב ככרטיס מאזן (ראה "מאזן ככרטיס" למטה), ולא כשורות חשבון בטקסט: היתרות שמסר (אם ביקש לכלול אותן), ההכנסות שעוד ייכנסו, והחיובים וההוצאות שמנה. סכום שאמר שלא לספור ("אולי", "לא נשקלל") לא נכנס; אפשר להזכיר אותו ב-note.
2. אחר כך, במשפט אחד, מה אומרת התחזית של האפליקציה לאותו חודש (net או endBalance), ומה ההבדל העיקרי ביניהם (למשל הוצאות רגילות שהוא לא מנה, כמו אוכל ודלק).
אסור לכתוב "אין לי את הנתונים" או "הנתון היחיד שיש לי" כשהמשתמש מסר אותם בשיחה. אם חסר נתון אחד שבלעדיו אי אפשר לחשב, שאל עליו שאלה אחת קצרה.
${BALANCE_RULE}`;

// The conversation sent with a question: the person's own messages in full
// (the figures they gave are there, sometimes many messages back), the
// advisor's answers shortened, except the newest ones.
function historyText(history, { keep = 12, fullAnswers = 4, userMax = 2000, answerMax = 400 } = {}) {
  const recent = Array.isArray(history) ? history.slice(-keep) : [];
  return recent.map((h, i) => {
    const isUser = h.role === 'user';
    const max = isUser || i >= recent.length - fullAnswers ? userMax : answerMax;
    return `${isUser ? (h.author || 'משתמש') : 'יועץ'}: ${String(h.text || '').slice(0, max)}`;
  }).join('\n');
}

module.exports = { OWN_NUMBERS_RULE, BALANCE_RULE, historyText };
