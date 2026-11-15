// A picture sent to the advisor with a question (a receipt, a bill, a
// screenshot). Read once for the answer and never stored. Pure, so the
// checks can be tested without the network.

// About 1MB of picture (the app makes it smaller on the device first).
const MAX_BASE64 = 1.45 * 1024 * 1024;

// "data:image/jpeg;base64,...." -> { media_type, data }, or an error text.
function parseImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'צריך תמונה (JPG, PNG או WEBP).' };
  if (m[2].length > MAX_BASE64) return { error: 'התמונה גדולה מדי.' };
  return { media_type: m[1], data: m[2] };
}

// What is sent to Claude: the picture first, then the question and the data.
function chatContent(text, image) {
  if (!image) return text;
  return [
    { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
    { type: 'text', text }
  ];
}

// Told to the advisor when a picture comes with the question.
const IMAGE_NOTE = '\nלהודעה הזאת מצורפת תמונה (למשל קבלה, חשבון, הצעת מחיר או צילום מסך). קרא ממנה רק מה שכתוב בה באמת, והעתק סכומים ותאריכים בדיוק. אם משהו לא קריא, אמור זאת. אם בתמונה יש הוצאה או הכנסה שכדאי לרשום, אמור מה הסכום, התאריך ובית העסק, ושאל אם לרשום. אל תכתוב שהתמונה נשמרה: היא לא נשמרת.\n';

module.exports = { parseImage, chatContent, IMAGE_NOTE, MAX_BASE64 };
