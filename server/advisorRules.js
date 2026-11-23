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

// The advisor's request as content blocks for the prompt cache: the rules
// (the same for every household, no personal data) and this household's data
// each end with a cache breakpoint, so a follow-up question within 5 minutes
// reads both from the cache; the turn (who writes, the conversation, the
// question) and a picture come after, and are never cached. A household's
// data is its own cache entry: it is never served to anyone else.
function cachedContent({ rules, data, turn }, image = null) {
  const out = [
    { type: 'text', text: rules, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: data, cache_control: { type: 'ephemeral' } }
  ];
  if (image) out.push({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } });
  out.push({ type: 'text', text: turn });
  return out;
}

// All the input of a request: new tokens and those written to or read from the cache.
const inputTokens = (u) => (Number(u && u.input_tokens) || 0) + (Number(u && u.cache_creation_input_tokens) || 0) + (Number(u && u.cache_read_input_tokens) || 0);

module.exports = { OWN_NUMBERS_RULE, BALANCE_RULE, historyText, cachedContent, inputTokens };
