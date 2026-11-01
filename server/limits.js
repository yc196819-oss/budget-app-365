// Limits on what goes to the AI, so one request (or one person) cannot run up
// the bill: text fields are cut to a sensible length before any prompt is
// built, and the whole service stops calling the AI for the day past a cap.
// Pure, except the day counter.

const MAX = { message: 2000, text: 8000, item: 2000, history: 20, statement: 12000 };

// The request body, with long text cut. File data (statements) is left as is:
// its size is held by the JSON limit and the import endpoint. A statement's
// text is longer than a question: the app sends it in parts of up to
// MAX.statement, so a 3-month bank statement is read whole.
function clipBody(body, { statement = false } = {}) {
  if (!body || typeof body !== 'object') return body;
  const out = { ...body };
  const cut = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n) : v);
  for (const k of ['message', 'question', 'destination', 'authorName']) out[k] = cut(out[k], MAX.message);
  for (const k of ['text', 'scenario', 'context']) if (typeof out[k] === 'string') out[k] = cut(out[k], statement && k === 'text' ? MAX.statement : MAX.text);
  for (const k of ['history', 'messages']) {
    if (Array.isArray(out[k])) out[k] = out[k].slice(-MAX.history).map((m) => (m && typeof m === 'object' ? { ...m, text: cut(m.text, MAX.item) } : m));
  }
  return out;
}

// Calls to the AI across everyone today; past the cap, no more until tomorrow.
function dailyCap(limit = Number(process.env.AI_DAILY_LIMIT) || 3000) {
  let day = '', count = 0;
  return {
    take(today) {
      if (today !== day) { day = today; count = 0; }
      if (count >= limit) return false;
      count += 1;
      return true;
    },
    get used() { return count; }
  };
}

module.exports = { MAX, clipBody, dailyCap };
