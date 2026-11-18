// Several shopping lists, like chats: "קנייה שבועית", "לשבת", "פארם". An item
// belongs to a list (list_id); one added before lists existed, or from a
// place that does not know them (the guest page, the advisor's chat), belongs
// to the first list. Pure.

const firstOf = (lists) => (lists || []).filter((l) => !l.archived_at).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null;

export function listOf(item, lists) {
  if (item.list_id && (lists || []).some((l) => l.id === item.list_id && !l.archived_at)) return item.list_id;
  const f = firstOf(lists);
  return f ? f.id : null;
}

// The open items of one list (bought ones still on it until "סיימתי לקנות").
export function itemsOf(items, listId, lists) {
  return (items || []).filter((i) => !i.cleared_at && listOf(i, lists) === listId);
}

// The lists for the screen, the most recently touched first: name, how many
// things, how many bought, the first few names, and when.
export function listRows(lists, items) {
  return (lists || []).filter((l) => !l.archived_at).map((l) => {
    const its = itemsOf(items, l.id, lists);
    const last = [l.updated_at, l.created_at, ...its.map((i) => i.created_at), ...its.map((i) => i.done_at)].filter(Boolean).sort().pop();
    return { ...l, count: its.length, done: its.filter((i) => i.done).length, preview: its.filter((i) => !i.done).slice(0, 4).map((i) => i.name), more: Math.max(0, its.filter((i) => !i.done).length - 4), last };
  }).sort((a, b) => String(b.last).localeCompare(String(a.last)));
}

// The list to compare first at the top of the tab: the one with the most
// still to buy (the most recent of those), or null when nothing is left.
export function compareFirst(rows) {
  const left = (rows || []).map((r) => ({ r, n: r.count - r.done })).filter((x) => x.n > 0);
  if (!left.length) return null;
  const best = left.reduce((a, b) => (b.n > a.n ? b : a));
  return { ...best.r, left: best.n };
}

// "היום", "אתמול", "לפני 3 ימים", or the date.
export function whenText(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const n = Math.round((day(now) - day(d)) / 86400000);
  if (n <= 0) return 'היום';
  if (n === 1) return 'אתמול';
  if (n < 7) return 'לפני ' + n + ' ימים';
  return d.getDate() + '.' + (d.getMonth() + 1);
}

// A list's name: what was typed, trimmed; never empty or too long.
export function cleanName(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || null;
}
