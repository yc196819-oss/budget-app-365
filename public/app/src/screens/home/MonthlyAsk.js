import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { monthlyMailChoice, setMonthlyMail } from '../../data/account.js';
import { showToast } from '../../lib/toast.js';

// Asked once: would you like a monthly summary by email? Nothing is sent
// unless the answer is yes; it can be changed any time in the profile.
export function MonthlyAsk({ userId, data }) {
  const [choice, setChoice] = useState(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (userId) monthlyMailChoice(userId).then(setChoice).catch(() => setChoice(false)); }, [userId]);
  if (choice !== null || !data.txs || !data.txs.length) return null;
  const answer = async (on) => {
    setBusy(true);
    try {
      await setMonthlyMail(userId, on);
      setChoice(on);
      showToast(on ? 'מעולה! הסיכום יגיע למייל בתחילת כל חודש' : 'בסדר, לא נשלח. אפשר לשנות בפרופיל');
    } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy(false);
  };
  return html`<div class="card stack monthly-ask" role="region" aria-label="סיכום חודשי במייל" style="border-inline-start:4px solid var(--accent)">
    <b>📬 לקבל סיכום חודשי למייל?</b>
    <span class="muted" style="font-size:14px;line-height:1.6">בתחילת כל חודש: כמה נכנס ויצא, מה בלט לעומת החודש הקודם, ו-3 דברים לחודש הבא. אפשר להפסיק בכל רגע.</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn" style="width:auto" disabled=${busy} onClick=${() => answer(true)}>כן, אשמח</button>
      <button type="button" class="btn btn-ghost" style="width:auto" disabled=${busy} onClick=${() => answer(false)}>לא תודה</button>
    </div>
  </div>`;
}
