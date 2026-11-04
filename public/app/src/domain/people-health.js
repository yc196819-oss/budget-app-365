// How the people using the app are doing, in words for the owner. Pure.

export const HEALTH = {
  good: { name: 'פעילים', mark: '●' },
  watch: { name: 'כדאי לבדוק', mark: '▲' },
  stuck: { name: 'תקועים', mark: '■' },
  gone: { name: 'נעלמו', mark: '○' }
};

export function healthCounts(users) {
  const out = { good: 0, watch: 0, stuck: 0, gone: 0 };
  for (const u of users || []) if (u.health && out[u.health.level] !== undefined) out[u.health.level]++;
  return out;
}

const n = (k, one, many) => (k === 1 ? one : k + ' ' + many);
// One sentence about today: who came, what they did, who needs help.
export function todaySummary(items) {
  const list = items || [];
  if (!list.length) return 'היום עוד אף אחד לא נכנס (חוץ ממך).';
  const fresh = list.filter((p) => p.newToday).length;
  const imported = list.filter((p) => p.imports > 0).length;
  const asked = list.filter((p) => p.asked > 0).length;
  const failed = list.filter((p) => p.importFails > 0 || p.errors > 0);
  const cost = list.reduce((s, p) => s + (Number(p.cost) || 0), 0);
  const help = list.filter((p) => p.health && p.health.level !== 'good');
  const parts = [
    'היום נכנסו ' + n(list.length, 'משתמש אחד', 'משתמשים') + (fresh ? ' (' + n(fresh, 'אחד חדש', 'חדשים') + ')' : '') + '.',
    imported ? n(imported, 'אחד העלה פירוט', 'העלו פירוט') + '.' : 'אף אחד לא העלה פירוט.',
    asked ? n(asked, 'אחד שאל את היועץ', 'שאלו את היועץ') + ', עלות AI היום $' + cost.toFixed(2) + '.' : '',
    failed.length ? 'נתקלו בתקלה: ' + failed.map((p) => p.name || p.who).join(', ') + '.' : 'בלי תקלות.',
    help.length ? 'כדאי לעזור ל: ' + help.map((p) => (p.name || p.who) + ' (' + p.health.label + ')').join(', ') + '.' : ''
  ];
  return parts.filter(Boolean).join(' ');
}
