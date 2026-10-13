// What every advisor answer keeps to, by Israeli law: general information and
// calculations about the household's own numbers, never a personal
// recommendation to buy or sell a specific security, fund or financial
// product (חוק הסדרת העיסוק בייעוץ השקעות, התשנ"ה-1995), and no
// professional legal or tax opinion. Pure, so it is tested.

const ADVICE_RULE = [
  'כללים מחייבים (חוק הסדרת העיסוק בייעוץ השקעות):',
  '- אינך יועץ השקעות, יועץ מס או עורך דין מורשה. תן מידע כללי, הסברים וחישובים על המספרים של המשפחה, לא ייעוץ אישי מקצועי.',
  '- אל תמליץ לקנות, למכור או להחזיק נייר ערך, מניה, קרן, מסלול, פוליסה או מוצר פיננסי ספציפי, ואל תציין שמות של מוצרים כאלה כהמלצה. אפשר להסביר סוגים ועקרונות (למשל: מה ההבדל בין פיקדון לקרן מחקה) ולהציע לבדוק עם בעל רישיון.',
  '- בשאלות על השקעות, פנסיה, משכנתא, מס או משפט: הוסף בסוף משפט קצר שזה מידע כללי ושכדאי לבדוק עם בעל רישיון מתאים.'
].join('\n');

// Prompts of the advisor (they open with "אתה יועץ") get the rule; others
// (classifying lines, reading statements) are left as they are.
function withAdviceRule(prompt) {
  const p = String(prompt || '');
  if (!/^\s*אתה יועץ/.test(p) || p.includes(ADVICE_RULE)) return p;
  return p + '\n\n' + ADVICE_RULE;
}

module.exports = { ADVICE_RULE, withAdviceRule };
