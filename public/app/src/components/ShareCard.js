import { html } from '../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './Icon.js';
import { myShare } from '../data/share.js';
import { shareLink, shareText, shareTargets, SHARE_TITLE } from '../domain/share.js';
import { track } from '../lib/telemetry.js';

// "Enjoying it? Tell your friends": the phone's share sheet with a ready
// message and a sign-up link. On a computer (most of our people, many
// without WhatsApp): email and copy first, WhatsApp last, shown at once.
export function ShareCard() {
  const [info, setInfo] = useState(null);
  const [more, setMore] = useState(() => typeof navigator !== 'undefined' && !navigator.share);
  const [copied, setCopied] = useState(false);
  // The buttons wait for this person's code, so a friend who joins from the
  // link is always counted (a link sent a moment too early had no code).
  useEffect(() => { myShare().then(setInfo, () => setInfo({ code: '', joined: 0 })); }, []);
  const link = shareLink(location.origin, info && info.code);
  const t = shareTargets(link);
  const share = async () => {
    track('share');
    if (navigator.share) {
      try { await navigator.share({ title: SHARE_TITLE, text: shareText(link) }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    setMore(true);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(t.text); setCopied(true); } catch (_e) { setMore(true); } };
  return html`<div class="card stack share-card">
    <b style="font-size:16px">נהנית? ספר לחבריך</b>
    <span class="muted" style="font-size:14px;line-height:1.55">שולחים לחברים הודעה מוכנה עם קישור להרשמה: במייל, בהודעה, או מעתיקים ומדביקים איפה שנוח.</span>
    <span class="share-netfree" style="font-size:14px;font-weight:700;color:var(--income)">✓ האתר פתוח למשתמשי נטפרי. כדאי לספר גם להם!</span>
    ${!info && html`<span class="muted share-wait" role="status" style="font-size:14px">מכינים את הקישור האישי שלך…</span>`}
    ${info && !more && html`<button type="button" class="btn" onClick=${share}><${Icon} name="share" />לשתף עם חברים</button>`}
    ${info && more && html`<div class="share-more" style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn" style="width:auto;flex:1;text-decoration:none" href=${t.email} onClick=${() => track('share')}><${Icon} name="mail" />במייל</a>
      <button type="button" class="btn btn-ghost" style="width:auto;flex:1" onClick=${() => { track('share'); copy(); }}>${copied ? 'הועתק ✓ אפשר להדביק' : 'להעתיק את ההודעה'}</button>
      <a class="btn btn-ghost" style="width:auto;flex:1;text-decoration:none" href=${t.whatsapp} target="_blank" rel="noopener" onClick=${() => track('share')}>וואטסאפ</a>
    </div>`}
    ${info && info.joined > 0 && html`<span class="share-joined" style="font-size:14px;color:var(--income)">${info.joined === 1 ? 'חבר אחד כבר הצטרף בזכותך. תודה!' : info.joined + ' חברים כבר הצטרפו בזכותך. תודה!'}</span>`}
  </div>`;
}
