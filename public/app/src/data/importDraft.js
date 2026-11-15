// The statement being checked, kept on this device until it is saved: leaving
// the check mid-way (a call, a look at something else) loses nothing. Kept
// for a week, then dropped. Only on this device, never sent anywhere.
const WEEK = 7 * 24 * 3600 * 1000;
const keyOf = (hid) => 'import:draft:' + (hid || '');

export function readDraft(hid, now = Date.now()) {
  try {
    const d = JSON.parse(localStorage.getItem(keyOf(hid)) || 'null');
    if (!d || !Array.isArray(d.items) || !d.items.length || !(now - d.at < WEEK)) return null;
    return d;
  } catch (_e) { return null; }
}

export function writeDraft(hid, draft, now = Date.now()) {
  try { localStorage.setItem(keyOf(hid), JSON.stringify({ ...draft, at: now })); } catch (_e) { /* full or blocked: the check still works */ }
}

export function dropDraft(hid) {
  try { localStorage.removeItem(keyOf(hid)); } catch (_e) { /* nothing to drop */ }
}

// A draft fits an upload opened for one account or card when it is that one's
// or was not tied to any.
export const draftFits = (draft, preset) => !!draft && (!preset || !draft.sourceId || draft.sourceId === preset.id);
