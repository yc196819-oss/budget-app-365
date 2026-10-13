// The terms of use in force. Everyone confirms them once, and again when the
// version changes (a material change). Pure.
export const TERMS_VERSION = '2026-10';

export function needsConsent(user) {
  const meta = (user && user.user_metadata) || {};
  return meta.terms_version !== TERMS_VERSION;
}

// What is written on the account when they agree.
export function consentData(now = new Date()) {
  return { terms_version: TERMS_VERSION, terms_accepted_at: now.toISOString() };
}
