// A name for a new (or renamed) category: trimmed, short, and not the same as
// another category in the same place (top level of its kind, or under the
// same parent). Returns { name } or { error } in the person's words.
export const CATEGORY_ICONS = ['🛒', '🍔', '🚗', '🏠', '💡', '👶', '🎓', '🏥', '👕', '🎁', '✈️', '🎉', '🐶', '📱', '💼', '💰', '📚', '⚽', '💄', '🔧'];

export function checkCategoryName(raw, { categories = [], kind = 'expense', parentId = null, exceptId = null } = {}) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (name.length < 2) return { error: 'כתבו שם של לפחות 2 אותיות' };
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const siblings = categories.filter((c) => c.id !== exceptId && (parentId ? c.parent_id === parentId : !c.parent_id && (c.kind || 'expense') === kind));
  const same = siblings.find((c) => norm(c.name) === norm(name));
  if (same) return { error: 'כבר יש קטגוריה בשם "' + same.name + '"', existing: same };
  return { name };
}
