import { html } from '../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { secondsLeft, clock, RESEND_AFTER_S } from '../domain/security.js';

// Under an emailed code: "didn't get it?" opens what to check, and a one-minute
// clock counts down until a new code can be sent.
export function ResendCode({ sentAt, onResend, busy }) {
  const [now, setNow] = useState(() => Date.now());
  const [help, setHelp] = useState(false);
  const left = secondsLeft(sentAt, now);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sentAt]);
  const r = 15, len = 2 * Math.PI * r;
  return html`<div class="resend">
    ${!help && html`<button type="button" class="btn-text" onClick=${() => setHelp(true)}>לא קיבלתי את המייל</button>`}
    ${help && html`<div class="resend-help card" role="status">
      <b>המייל לא הגיע?</b>
      <ul>
        <li>בדקו בתיקיית <b>הספאם</b>, ובג'ימייל גם בלשונית "קידומי מכירות".</li>
        <li>חפשו מייל מ"התקציב שלנו" שהנושא שלו מתחיל בקוד.</li>
        <li>לפעמים לוקח למייל דקה או שתיים להגיע.</li>
      </ul>
    </div>`}
    ${left > 0
      ? html`<div class="resend-clock" aria-label=${'אפשר לשלוח קוד חדש בעוד ' + left + ' שניות'}>
          <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
            <circle cx="19" cy="19" r=${r} class="resend-track" />
            <circle cx="19" cy="19" r=${r} class="resend-ring" stroke-dasharray=${len} stroke-dashoffset=${len * (1 - left / RESEND_AFTER_S)} transform="rotate(-90 19 19)" />
          </svg>
          <span>אפשר לשלוח קוד חדש בעוד <b class="num" dir="ltr">${clock(left)}</b></span>
        </div>`
      : html`<button type="button" class="btn btn-ghost" onClick=${() => { setHelp(false); onResend(); }} disabled=${busy}>לשלוח קוד חדש</button>`}
  </div>`;
}
