// "Always file X as Y": the household's own rules, chosen after a correction.
// They come first when a statement is read, before past choices and the AI. Pure.
import { merchantKey } from './money.js';

export const ruleKey = (description) => merchantKey(description);

// The rule for a line: same kind (expense/income) and the same merchant
// (one key a word-prefix of the other, as the app matches merchants).
export function findRule(rules, type, description) {
  const k = ruleKey(description);
  if (!k) return null;
  const t = type === 'income' ? 'income' : 'expense';
  return (rules || []).find((r) => r.type === t && r.category_id && (r.match === k || k.startsWith(r.match + ' ') || r.match.startsWith(k + ' '))) || null;
}

export function applyRules(items, rules) {
  if (!rules || !rules.length) return items;
  return items.map((t) => {
    const r = findRule(rules, t.type, t.description);
    return r ? { ...t, category_id: r.category_id, subcategory_id: r.subcategory_id || null, auto: 'rule' } : t;
  });
}

// After a category change: ask to keep it as a rule, unless that is already the rule.
export function shouldAskRule(rules, tx, category_id, subcategory_id) {
  if (!category_id || !ruleKey(tx.description)) return false;
  const r = findRule(rules, tx.type, tx.description);
  return !(r && r.category_id === category_id && (r.subcategory_id || null) === (subcategory_id || null));
}
