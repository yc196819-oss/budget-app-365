// Pure logic for a new household: categories that fit their life, the first
// monthly picture from income and fixed costs, and what to create. No DOM,
// no network.

// The same default categories the current app creates, so both apps agree.
export const DEFAULT_CATS = [
  { name: 'אוכל', icon: '🍽️', kind: 'expense', subs: ['סופר', 'מסעדות ואוכל בחוץ'] },
  { name: 'בית ודיור', icon: '🏠', kind: 'expense', subs: ['שכירות / משכנתא', 'חשבונות', 'ריהוט ותחזוקה'] },
  { name: 'בריאות', icon: '💊', kind: 'expense', subs: ['רופאים', 'תרופות', 'ביטוח בריאות'] },
  { name: 'פנאי ובידור', icon: '🎭', kind: 'expense', subs: ['ספורט', 'תרבות', 'נסיעות'] },
  { name: 'שונות', icon: '📦', kind: 'expense', subs: [] },
  { name: 'משכורת', icon: '💼', kind: 'income', subs: [] },
  { name: 'עבודה צדדית / פרילנס', icon: '💻', kind: 'income', subs: [] },
  { name: 'החזרים והטבות', icon: '🧾', kind: 'income', subs: [] },
  { name: 'מתנות', icon: '🎁', kind: 'income', subs: [] },
  { name: 'הכנסה אחרת', icon: '💰', kind: 'income', subs: [] }
];

// "What is part of your life": each adds categories.
export const LIFE = [
  { key: 'car', label: 'רכב', cats: [{ name: 'רכב', icon: '🚗', kind: 'expense', subs: ['דלק', 'אגרה', 'מוסך', 'ביטוח רכב'] }] },
  { key: 'kids', label: 'ילדים', cats: [{ name: 'ילדים', icon: '🧸', kind: 'expense', subs: ['גן ומסגרות', 'חוגים', 'ביגוד'] }] },
  { key: 'pets', label: 'חיות מחמד', cats: [{ name: 'חיות מחמד', icon: '🐾', kind: 'expense', subs: ['אוכל', 'וטרינר'] }] },
  { key: 'subs', label: 'מנויים ואפליקציות', cats: [{ name: 'מנויים', icon: '📺', kind: 'expense', subs: ['סטרימינג', 'אפליקציות'] }] },
  { key: 'study', label: 'לימודים', cats: [{ name: 'לימודים', icon: '🎓', kind: 'expense', subs: ['שכר לימוד', 'ספרים וציוד'] }] },
  { key: 'parents', label: 'עזרה מההורים', cats: [{ name: 'עזרה מההורים', icon: '👨‍👩‍👧', kind: 'income', subs: [] }] },
  { key: 'invest', label: 'השקעות', cats: [{ name: 'רווחי השקעות', icon: '📈', kind: 'income', subs: [] }] },
  { key: 'maaser', label: 'מעשרות ותרומות', cats: [{ name: 'תרומות', icon: '🤲', kind: 'expense', subs: [] }] }
];

export function categoriesFor(life) {
  const extra = LIFE.filter((l) => life[l.key]).flatMap((l) => l.cats);
  const all = [...DEFAULT_CATS, ...extra];
  // Expenses first, then income, as in the category screens.
  return [...all.filter((c) => c.kind === 'expense'), ...all.filter((c) => c.kind === 'income')];
}

// Fixed monthly costs asked about; each goes to a category budget.
export const FIXED = [
  { key: 'rent', label: 'שכירות או משכנתא', category: 'בית ודיור' },
  { key: 'arnona', label: 'ארנונה', category: 'בית ודיור' },
  { key: 'bills', label: 'חשמל, מים וגז', category: 'בית ודיור' },
  { key: 'comm', label: 'טלפון ואינטרנט', category: 'בית ודיור' },
  { key: 'kindergarten', label: 'גן או מסגרות', category: 'ילדים' },
  { key: 'insurance', label: 'ביטוחים', category: 'בריאות' },
  { key: 'loans', label: 'החזרי הלוואות', category: 'שונות' }
];

const num = (v) => Math.max(0, Number(String(v || '').replace(/[^\d.]/g, '')) || 0);

// The first monthly picture: income − fixed − saving = left for living.
export function firstPicture({ income, fixed = {}, saving = 0 }) {
  const inc = num(income);
  const fixedTotal = FIXED.reduce((s, f) => s + num(fixed[f.key]), 0);
  const save = saving > 0 ? saving : 0;
  const left = inc - fixedTotal - save;
  return { income: inc, fixedTotal, saving: save, left, perDay: left > 0 ? left / 30 : 0, ok: inc > 0 && left >= 0 };
}

// Monthly budgets from the questionnaire: the fixed costs per category, and
// what is left for living split over food and the rest (60/40), only when
// the numbers add up. Returns [{ category: name, amount }].
export function initialBudgets(answers, categoryNames) {
  const pic = firstPicture(answers);
  const out = new Map();
  for (const f of FIXED) {
    const v = num((answers.fixed || {})[f.key]);
    if (!v) continue;
    const cat = categoryNames.includes(f.category) ? f.category : 'שונות';
    out.set(cat, (out.get(cat) || 0) + v);
  }
  if (pic.ok && pic.left > 0) {
    out.set('אוכל', (out.get('אוכל') || 0) + Math.round((pic.left * 0.6) / 100) * 100);
    out.set('שונות', (out.get('שונות') || 0) + Math.round((pic.left * 0.4) / 100) * 100);
  }
  return [...out.entries()].filter(([, v]) => v > 0).map(([category, amount]) => ({ category, amount }));
}

// An emergency fund of 3 months of what the household spends.
export function emergencyTarget(answers) {
  const pic = firstPicture(answers);
  if (!pic.income) return 0;
  const monthly = pic.fixedTotal + Math.max(0, pic.left);
  return Math.max(10000, Math.round((monthly * 3) / 1000) * 1000);
}

export function cleanCards(cards) {
  return cards
    .map((c) => ({ name: String(c.name || '').trim(), last4: String(c.last4 || '').replace(/\D/g, '').slice(0, 4), billing_day: c.type === 'direct' ? null : Number(c.day) || 10, type: c.type === 'direct' ? 'direct' : 'credit' }))
    .filter((c) => c.name);
}

export function householdName(name, partner, together) {
  const n = String(name || '').trim();
  const p = String(partner || '').trim();
  if (together && p) return n + ' ו' + p;
  return n ? 'משק הבית של ' + n : 'משק הבית שלנו';
}

export function inviteLink(origin, code) {
  return origin + '/app/?invite=' + encodeURIComponent(code);
}

export const INVITE_ERRORS = {
  used: 'הקישור הזה כבר נוצל. כל קישור עובד פעם אחת. בקשו קישור חדש.',
  expired: 'תוקף הקישור פג. בקשו קישור חדש.',
  revoked: 'הקישור בוטל. בקשו קישור חדש.',
  invalid: 'הקישור לא תקין. בדקו שהעתקתם אותו במלואו.',
  already_member: 'אתם כבר חברים במשק הבית הזה.',
  HOUSEHOLD_HAS_DATA: 'כבר יש לכם משק בית עם נתונים, ולכן אי אפשר להצטרף לאחר מהחשבון הזה.'
};
