import { html } from '../lib/html.js';
import { Icon } from './Icon.js';
import { go } from '../lib/go.js';

// "Something not working? An idea?": one tap to write to us, from the home
// screen, so nobody has to look for it in the profile.
export function TalkToUs() {
  return html`<div class="card talk-to-us" style="display:flex;align-items:center;gap:12px">
    <span class="cat-icon" style="background:var(--surface-2)" aria-hidden="true"><${Icon} name="chat" /></span>
    <span style="flex:1;display:flex;flex-direction:column;min-width:0">
      <b style="font-size:15px">משהו לא עובד? יש לך רעיון?</b>
      <span class="muted" style="font-size:13px;line-height:1.5">כותבים לנו כאן, ואנחנו עונים בתוך האפליקציה.</span>
    </span>
    <button type="button" class="btn btn-ghost" style="width:auto;padding:0 14px" onClick=${() => go('profile/feedback')}>לכתוב לנו</button>
  </div>`;
}
