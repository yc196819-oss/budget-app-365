// The owner's inbox of requests: order and filters. Pure.

// Pinned first, then unread, then the newest.
export function sortInbox(items) {
  return [...items].sort((a, b) => (b.pinned - a.pinned) || ((b.unread > 0) - (a.unread > 0)) || String(b.last_at).localeCompare(String(a.last_at)));
}
export function filterInbox(items, filter, q = '') {
  const t = q.trim();
  return items.filter((f) => (filter === 'archived' ? f.archived : !f.archived)
    && (filter === 'unread' ? f.unread > 0 : filter === 'open' ? !f.closed : filter === 'bug' || filter === 'idea' ? f.kind === filter : true)
    && (!t || f.who.includes(t) || f.messages.some((m) => m.text.includes(t))));
}
