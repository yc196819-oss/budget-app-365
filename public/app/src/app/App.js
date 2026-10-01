import { html } from '../lib/html.js';
import { useRoute } from './useRoute.js';
import { useSession } from './useSession.js';
import { Shell } from './Shell.js';
import { LoginScreen } from '../screens/auth/LoginScreen.js';

export function App() {
  const tab = useRoute();
  const session = useSession();
  if (session.loading) return html`<div class="boot" role="status">טוען…</div>`;
  if (!session.user) return html`<${LoginScreen} />`;
  return html`<${Shell} tab=${tab} session=${session} />`;
}
