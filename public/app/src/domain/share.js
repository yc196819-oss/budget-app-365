// "Enjoying it? Tell your friends": the message, the link with the sharer's
// code, and where to send it when the phone has no share sheet. Pure.

export const REF_RE = /^[0-9a-f]{6}$/;

export function shareLink(origin, code) {
  return String(origin || '').replace(/\/$/, '') + '/app/' + (REF_RE.test(String(code || '')) ? '?ref=' + code : '');
}

export function shareText(link) {
  return [
    'היי, רציתי להמליץ לך על "התקציב שלנו": אפליקציה בעברית, בחינם, שעוזרת לנהל את הכסף של הבית.',
    '',
    '✓ מעלים פירוט אשראי ורואים בדיוק לאן הכסף הולך',
    '✓ רואים כמה נשאר להוציא החודש, ומה צפוי בחודשים הקרובים',
    '✓ יועץ חכם שעונה על כל שאלה על הכסף שלכם',
    '✓ אפשר לנהל ביחד עם בן או בת הזוג',
    '',
    'ההרשמה לוקחת דקה: ' + link
  ].join('\n');
}

export const SHARE_TITLE = 'התקציב שלנו: ניהול התקציב של הבית';

// For a computer (no share sheet): WhatsApp, email, and copying the text.
export function shareTargets(link) {
  const text = shareText(link);
  return {
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(text),
    email: 'mailto:?subject=' + encodeURIComponent(SHARE_TITLE) + '&body=' + encodeURIComponent(text),
    text
  };
}

// A "?ref=" in the address when someone arrives from a friend's link.
export function refFrom(search) {
  try {
    const r = new URLSearchParams(String(search || '')).get('ref');
    return r && REF_RE.test(r) ? r : null;
  } catch (_e) { return null; }
}
