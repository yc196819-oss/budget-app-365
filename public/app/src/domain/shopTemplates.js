// Ready carts the advisor fills for the household: for the week, Shabbat, a
// holiday, or a meal for guests (dairy or meat, which do not mix). Amounts
// are per person, sized to the people at home; a few things are one package
// whatever the number (candles, oil). Pure.
import { aisleOf } from './shopping.js';

// [name, amount per person, unit, scales with people?, department (when the name does not say)]
const T = {
  week: { title: 'סל לשבוע', items: [
    ['חלב 3%', 1.5, 'ליטר'], ['ביצים', 5, "יח'"], ['לחם', 1.5, ''], ['גבינה לבנה', 1, 'גביעים'], ["קוטג'", 1, 'גביעים'], ['יוגורט', 3, "יח'"],
    ['עגבניות', 0.7, 'ק"ג'], ['מלפפונים', 0.7, 'ק"ג'], ['בצל', 0.3, 'ק"ג'], ['תפוחי אדמה', 0.6, 'ק"ג'], ['פירות העונה', 1.2, 'ק"ג'],
    ['חזה עוף', 0.5, 'ק"ג'], ['אורז', 0.25, 'ק"ג'], ['פסטה', 0.25, 'ק"ג'], ['טונה', 1, 'קופסאות'],
    ['שמן', 1, 'בקבוקים', false], ['נייר טואלט', 1, 'חבילות', false], ['נוזל כלים', 1, 'בקבוקים', false]
  ] },
  shabbat: { title: 'סל לשבת', items: [
    ['חלות', 0.7, ''], ['יין לקידוש', 0.25, 'בקבוקים'], ['עוף (חלקים)', 0.4, 'ק"ג'], ['דג לשבת', 0.15, 'ק"ג'], ['סלטים מוכנים', 0.5, 'קופסאות'],
    ['ירקות לסלט', 0.4, 'ק"ג'], ['תפוחי אדמה', 0.3, 'ק"ג'], ['אורז', 0.1, 'ק"ג'], ['שתייה קלה', 0.4, 'בקבוקים', true, 'drinks'], ['עוגה', 0.15, ''],
    ['פירות', 0.3, 'ק"ג'], ['נרות שבת', 1, 'חבילות', false, 'clean']
  ] },
  holiday: { title: 'סל לחג', items: [
    ['חלות', 0.7, ''], ['יין לקידוש', 0.3, 'בקבוקים'], ['בשר לצלי', 0.25, 'ק"ג'], ['עוף (חלקים)', 0.3, 'ק"ג'], ['דג', 0.15, 'ק"ג'],
    ['סלטים מוכנים', 0.6, 'קופסאות'], ['ירקות לסלט', 0.5, 'ק"ג'], ['תפוחי אדמה', 0.4, 'ק"ג'], ['אורז', 0.12, 'ק"ג'],
    ['פירות', 0.5, 'ק"ג'], ['עוגה', 0.2, ''], ['שתייה קלה', 0.5, 'בקבוקים', true, 'drinks'], ['חד פעמי (צלחות וכוסות)', 1, 'חבילות', false, 'clean'], ['נרות', 1, 'חבילות', false, 'clean']
  ] },
  'guests-dairy': { title: 'ארוחה חלבית לאורחים', items: [
    ['גבינה צהובה', 0.08, 'ק"ג'], ['גבינה לבנה', 0.3, 'גביעים'], ['גבינה מלוחה', 0.05, 'ק"ג'], ['לחמניות', 2, ''], ['ביצים', 2, "יח'"],
    ['ירקות לסלט', 0.3, 'ק"ג'], ['פסטה', 0.12, 'ק"ג'], ['שמנת לבישול', 0.15, 'קופסאות'], ['סלמון', 0.15, 'ק"ג'],
    ['עוגת גבינה', 0.15, ''], ['שתייה קלה', 0.5, 'בקבוקים', true, 'drinks'], ['מפיות', 1, 'חבילות', false, 'clean']
  ] },
  'guests-meat': { title: 'ארוחה בשרית לאורחים', items: [
    ['בשר / עוף לצלייה', 0.35, 'ק"ג'], ['אורז', 0.1, 'ק"ג'], ['תפוחי אדמה', 0.3, 'ק"ג'], ['ירקות לסלט', 0.3, 'ק"ג'],
    ['סלטים מוכנים', 0.4, 'קופסאות'], ['לחמניות', 1.5, ''], ['חומוס', 0.2, 'קופסאות'], ['עוגה פרווה', 0.15, ''],
    ['שתייה קלה', 0.5, 'בקבוקים', true, 'drinks'], ['חד פעמי (צלחות וכוסות)', 1, 'חבילות', false, 'clean']
  ] }
};

export const TEMPLATES = [
  { key: 'week', label: 'לשבוע', hint: 'הבסיס לבית' },
  { key: 'shabbat', label: 'לשבת', hint: 'חלות, יין, אוכל' },
  { key: 'holiday', label: 'לחג', hint: 'ארוחת חג' },
  { key: 'guests', label: 'ארוחה לאורחים', hint: 'חלבית או בשרית' }
];

// A ready cart as the advisor's list: { title, people, kosher, items }.
// meal: 'dairy' | 'meat' (a meal for guests only).
export function fromTemplate(key, people, { meal = 'meat', kosher = null } = {}) {
  const k = key === 'guests' ? 'guests-' + (meal === 'dairy' ? 'dairy' : 'meat') : key;
  const t = T[k];
  if (!t) return null;
  const p = Math.max(1, Math.min(30, Math.round(Number(people) || 4)));
  return {
    title: t.title,
    people: p,
    kosher: kosher || '',
    template: k,
    items: t.items.map(([name, per, unit, scale = true, aisle = null]) => ({
      name, unit, aisle: aisle || aisleOf(name), scale,
      qty: scale ? Math.round(per * p * 100) / 100 : per
    }))
  };
}

// Enough of this home's own buying to make the cart theirs (the advisor
// then adapts the ready one to it): a few products bought more than once.
export const personal = (usual) => (usual || []).filter((u) => u.times >= 2).length >= 4;
