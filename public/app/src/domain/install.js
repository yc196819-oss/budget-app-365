// Whether to suggest installing the app on the phone, and how. Pure.
//
//   standalone  already opened from the home screen (installed)
//   ios         iPhone / iPad: installed by hand, from the share menu
//   hasPrompt   the browser offered its own install dialog (Android Chrome,
//               desktop Chrome/Edge)
//   mobile      a phone or tablet
//   dismissedAt when "not now" was pressed (ms), shown again after 14 days

export const SNOOZE_DAYS = 14;

// 'hidden' | 'prompt' (one button) | 'ios' (share → add to home screen)
// | 'manual' (the browser menu → add to home screen)
export function installMode({ standalone, ios, hasPrompt, mobile }) {
  if (standalone) return 'hidden';
  if (hasPrompt) return 'prompt';
  if (ios) return 'ios';
  return mobile ? 'manual' : 'hidden';
}

// The card on the home screen: phones only, and not while snoozed.
export function showInstallCard(env, dismissedAt, now = Date.now()) {
  const mode = installMode(env);
  if (mode === 'hidden' || !env.mobile) return false;
  const at = Number(dismissedAt) || 0;
  return !at || now - at >= SNOOZE_DAYS * 86400000;
}

export function isIOS(ua = '', touchPoints = 0) {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

export function isMobile(ua = '', touchPoints = 0) {
  return isIOS(ua, touchPoints) || /Android|Mobile/i.test(ua);
}
