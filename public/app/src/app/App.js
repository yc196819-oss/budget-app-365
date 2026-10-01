import { html } from '../lib/html.js';
import { useRoute } from './useRoute.js';
import { useSession } from './useSession.js';
import { Shell } from './Shell.js';
import { LoginScreen } from '../screens/auth/LoginScreen.js';
import { Onboarding } from '../screens/onboarding/Onboarding.js';
import { JoinInvite } from '../screens/onboarding/JoinInvite.js';
import { readLocal, writeLocal } from '../lib/storage.js';
import { PENDING_INVITE, DECLINED_INVITE } from '../data/onboarding.js';

// An invite link (/app/?invite=CODE) is remembered until the person is
// signed in, through sign-up and email confirmation, then taken off the URL.
(() => {
  const code = new URLSearchParams(location.search).get('invite');
  if (code) {
    writeLocal(PENDING_INVITE, code);
    history.replaceState(null, '', location.pathname + location.hash);
  }
})();

export function App() {
  const tab = useRoute();
  const session = useSession();
  if (session.loading) return html`<div class="boot" role="status">טוען…</div>`;
  if (!session.user) return html`<${LoginScreen} />`;
  if (!session.household) {
    const invite = readLocal(PENDING_INVITE, '') || (session.user.user_metadata && session.user.user_metadata.invite_code) || '';
    if (invite && invite !== readLocal(DECLINED_INVITE, '')) return html`<${JoinInvite} code=${invite} session=${session} />`;
    return html`<${Onboarding} session=${session} />`;
  }
  return html`<${Shell} tab=${tab} session=${session} />`;
}
