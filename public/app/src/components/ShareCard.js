import { html } from '../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './Icon.js';
import { myShare } from '../data/share.js';
import { shareLink, shareText, shareTargets, SHARE_TITLE } from '../domain/share.js';
import { track } from '../lib/telemetry.js';

// "Enjoying it? Tell your friends": the phone's share sheet (WhatsApp, mail,
// messages…) with a ready message and a sign-up link; on a computer,
// WhatsApp, email and copy.
export function ShareCard() {
  const [info, setInfo] = useState(null);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
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
    <span class="muted" style="font-size:14px;line-height:1.55">שולחים לחברים הודעה מוכנה עם קישור להרשמה, בוואטסאפ, במייל או בכל אפליקציה אחרת.</span>
    <button type="button" class="btn" onClick=${share}><${Icon} name="share" />לשתף עם חברים</button>
    ${more && html`<div class="share-more" style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn-ghost" style="width:auto;flex:1;text-decoration:none" href=${t.whatsapp} target="_blank" rel="noopener" onClick=${() => track('share')}>וואטסאפ</a>
      <a class="btn btn-ghost" style="width:auto;flex:1;text-decoration:none" href=${t.email} onClick=${() => track('share')}>מייל</a>
      <button type="button" class="btn btn-ghost" style="width:auto;flex:1" onClick=${copy}>${copied ? 'הועתק ✓' : 'להעתיק'}</button>
    </div>`}
    ${info && info.joined > 0 && html`<span class="share-joined" style="font-size:14px;color:var(--income)">${info.joined === 1 ? 'חבר אחד כבר הצטרף בזכותך. תודה!' : info.joined + ' חברים כבר הצטרפו בזכותך. תודה!'}</span>`}
  </div>`;
}
