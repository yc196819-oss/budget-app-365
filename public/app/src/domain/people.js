// Addressing people by name and in the right form ("אתה" or "את"), never
// "את/ה" or "בן/בת הזוג". Pure.

// 'm' | 'f' | null (not chosen yet)
export const genderOf = (genders, id) => ((genders || {})[id] === 'm' || (genders || {})[id] === 'f' ? genders[id] : null);

// The right word for the person; both, joined by "או", until they choose.
export function g(gender, m, f) {
  if (gender === 'm') return m;
  if (gender === 'f') return f;
  return m + ' או ' + f;
}

export function partnerWord(gender) {
  return gender === 'm' ? 'בן הזוג' : gender === 'f' ? 'בת הזוג' : 'בן או בת הזוג';
}

// A display name that is really a username or an email ("budgetapp2852"):
// not used to address the person.
export function looksLikeUsername(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (/[@\d]/.test(s)) return true;
  return /^[a-z._-]+$/i.test(s) && !/\s/.test(s) && s === s.toLowerCase();
}

// The name to address someone by, or '' when there is no real one.
export function realName(name) { return looksLikeUsername(name) ? '' : String(name).trim(); }
