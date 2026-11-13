// Empty accounts nobody uses: no transactions, nobody else in the
// household, and no sign-in for 3 months. Two weeks before, the person is
// told by email (unless they asked for no emails); signing in once keeps the
// account. Then it is deleted the way "delete my account" deletes it. Pure.

const DAY = 86400000;
const INACTIVE = 90 * DAY;
const NOTICE = 14 * DAY;

// users: [{ id, email, lastSeen (ms), txs, partners, quiet (no emails), keep (the owner) }]
// warned: Map id -> warned at (ms). Returns { warn: [user], remove: [user] }.
function cleanupPlan(users, warned, now = Date.now(), { max = 20 } = {}) {
  const warn = [], remove = [];
  for (const u of users) {
    if (u.keep || u.txs > 0 || u.partners > 0 || !Number.isFinite(u.lastSeen)) continue;
    const idle = now - u.lastSeen;
    if (idle < INACTIVE - NOTICE) continue;
    const at = warned.get(u.id);
    // A warning from before the person last came back does not count.
    if (!at || at < u.lastSeen) { warn.push(u); continue; }
    if (idle >= INACTIVE && now - at >= NOTICE) remove.push(u);
  }
  return { warn, remove: remove.slice(0, max) };
}

// The date it will be deleted, for the email (Israel, d.m.yyyy).
function deleteDate(now = Date.now()) {
  const d = new Date(now + NOTICE);
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
}

function warningMail({ name, date, link }) {
  const hi = name ? 'שלום ' + name + ',' : 'שלום,';
  const text = hi + '\n\nלא נכנסתם ל"התקציב שלנו" כבר 3 חודשים, ואין בחשבון שלכם נתונים. כדי לא לשמור מידע בלי צורך, נמחק את החשבון ב-' + date + '.\n\nרוצים להשאיר אותו? מספיק להיכנס פעם אחת: ' + link + '\n\nאם לא, אין צורך לעשות כלום.';
  const html = '<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.7;color:#221A13">'
    + '<p>' + esc(hi) + '</p><p>לא נכנסתם ל"התקציב שלנו" כבר 3 חודשים, ואין בחשבון שלכם נתונים. כדי לא לשמור מידע בלי צורך, נמחק את החשבון ב-<b>' + esc(date) + '</b>.</p>'
    + '<p>רוצים להשאיר אותו? מספיק להיכנס פעם אחת:</p>'
    + '<p><a href="' + esc(link) + '" style="display:inline-block;background:#92490A;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:12px">להיכנס לחשבון</a></p>'
    + '<p style="color:#6B5948">אם לא, אין צורך לעשות כלום.</p></div>';
  return { subject: 'החשבון שלכם יימחק ב-' + date + ', אלא אם תיכנסו', text, html };
}
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

module.exports = { cleanupPlan, deleteDate, warningMail, INACTIVE, NOTICE };
