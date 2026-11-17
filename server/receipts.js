// A supermarket receipt photographed in the shopping tab: the AI reads the
// store, the date and the lines (name, how many, price paid), and this module
// makes that answer safe to use. The photo is not kept. Pure.

const PROMPT = [
  'זו תמונה של קבלה מסופרמרקט או חנות בישראל. קרא אותה והחזר JSON בלבד, בלי טקסט נוסף, במבנה:',
  '{"store":"שם החנות או הרשת","date":"YYYY-MM-DD","total":0,"items":[{"name":"שם המוצר","code":"7290000000000","qty":1,"price":0,"unit_price":null}]}',
  'כללים:',
  '- name: שם המוצר כפי שכתוב, בעברית, בלי ברקוד ובלי קוד פנימי. אם השם מקוצר (למשל "חלב תנו 3%"), השלם למשהו מובן ("חלב תנובה 3%") רק כשברור.',
  '- code: הברקוד או הקוד שמודפס בשורה של המוצר (ספרות בלבד). אם אין: null.',
  '- qty: כמה יחידות נקנו (מספר). מוצר במשקל: המשקל בק"ג (למשל 1.536).',
  '- unit_price: במוצר במשקל, המחיר לק"ג שכתוב בשורה (למשל 59.90). אחרת null.',
  '- price: הסכום ששולם על השורה כולה, בשקלים, אחרי הנחה של אותה שורה אם כתובה מתחתיה.',
  '- אל תכלול שורות שאינן מוצרים: סה"כ, מע"מ, עודף, אמצעי תשלום, פיקדון בקבוקים, שקית, הנחת מועדון כללית, נקודות.',
  '- total: הסכום הכולל לתשלום. date: תאריך הקנייה. מה שלא כתוב או לא קריא: null.',
  '- אם התמונה אינה קבלה: {"error":"not_receipt"}.'
].join('\n');

const NOT_ITEM = /^(סה"?כ|סהכ|סך הכל|מע"?מ|עודף|מזומן|אשראי|ויזה|ישראכרט|מאסטרקארד|כרטיס|פיקדון|פקדון|שקית|נקודות|הנחת מועדון|לתשלום|total|vat|change)/i;
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// The AI's text → { store, date, total, items } or { error }. Lines without a
// name, non-products and absurd amounts are dropped; at most 120 lines.
function parseReceipt(output, { today = new Date() } = {}) {
  const txt = String(output || '').trim().replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '');
  let r = null;
  try { r = JSON.parse(txt); } catch (_e) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { r = JSON.parse(m[0]); } catch (_e2) { r = null; } }
  }
  if (!r || typeof r !== 'object') return { error: 'unreadable' };
  if (r.error) return { error: r.error === 'not_receipt' ? 'not_receipt' : 'unreadable' };
  const items = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const name = clean(it && it.name, 80);
    if (name.length < 2 || NOT_ITEM.test(name) || !/[א-תa-z]/i.test(name)) continue;
    let qty = num(it.qty);
    if (!(qty > 0) || qty > 99) qty = 1;
    let price = num(it.price);
    if (!(price > 0) || price > 5000) price = null;
    const line = { name, qty: Math.round(qty * 1000) / 1000, price: price === null ? null : Math.round(price * 100) / 100 };
    // The barcode (or the store's own code) printed on the line: the price
    // check finds the product by it.
    const code = String((it && it.code) ?? '').replace(/\D/g, '');
    if (code.length >= 3 && code.length <= 14) line.code = code;
    // Weighed: a weight in kilos, and the kilo price when it is written.
    if (!Number.isInteger(line.qty)) {
      line.weighed = true;
      const kg = num(it.unit_price);
      if (kg > 0 && kg < 1000) line.unit_price = Math.round(kg * 100) / 100;
    }
    items.push(line);
    if (items.length >= 120) break;
  }
  if (!items.length) return { error: 'no_items' };
  let date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? String(r.date) : null;
  // A date in the future or years back is a misread: today instead.
  if (date) {
    const d = new Date(date + 'T12:00:00Z');
    if (Number.isNaN(d.getTime()) || d > new Date(today.getTime() + 2 * 86400000) || d < new Date(today.getTime() - 400 * 86400000)) date = null;
  }
  const total = num(r.total);
  return { store: clean(r.store, 60) || null, date, total: total > 0 && total < 50000 ? Math.round(total * 100) / 100 : null, items };
}

module.exports = { PROMPT, parseReceipt };
