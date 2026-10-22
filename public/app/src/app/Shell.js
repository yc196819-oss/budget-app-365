import { html } from '../lib/html.js';
import { track } from '../lib/telemetry.js';
import { Loading } from '../components/Loading.js';
import { useEffect, useState } from 'preact/hooks';
import { TABS } from '../domain/routes.js';
import { dateLabel, initials } from '../domain/format.js';
import { readLocal, writeLocal } from '../lib/storage.js';
import { Icon } from '../components/Icon.js';
import { BottomNav } from '../components/BottomNav.js';
import { Sidebar } from '../components/Sidebar.js';
import { AdvisorRail } from '../components/AdvisorRail.js';
import { Sheet } from '../components/Sheet.js';
import { SoonCard } from '../components/SoonCard.js';
import { HomeScreen } from '../screens/home/HomeScreen.js';
import { MoneyScreen } from '../screens/money/MoneyScreen.js';
import { PlansScreen } from '../screens/plans/PlansScreen.js';
import { AssetsScreen } from '../screens/assets/AssetsScreen.js';
import { TogetherScreen } from '../screens/together/TogetherScreen.js';
import { useDecisions } from '../data/useDecisions.js';
import { pendingCount, unreadTotal } from '../domain/decisions.js';
import { seenAt, onIncoming } from '../data/decisions.js';
import { showToast } from '../lib/toast.js';
import { shortcut, isTyping } from '../domain/shortcuts.js';
import { hrefFor } from '../domain/routes.js';
import { ProfileSheet } from '../screens/profile/ProfileSheet.js';
import { AddSheet } from '../screens/add/AddSheet.js';
import { ImportSheet } from '../screens/import/ImportSheet.js';
import { LearnSheet } from '../screens/learn/LearnSheet.js';
import { ToastHost } from '../components/ToastHost.js';
import { useHousehold } from '../data/useHousehold.js';
import { useMedia } from '../lib/useMedia.js';
import { AdvisorPanel } from '../screens/advisor/AdvisorPanel.js';

const SCREENS = { home: HomeScreen, money: MoneyScreen, together: TogetherScreen, plans: PlansScreen, assets: AssetsScreen };

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function Shell({ tab, session }) {
  // One overlay at a time: 'profile' | 'add' | 'voice' | 'import' | 'learn' | 'advisor' | 'talk' | null.
  const [overlay, setOverlay] = useState(null);
  const [theme, setTheme] = useState(() => readLocal('theme', ''));
  const data = useHousehold(session.household?.household_id, session.user.id);
  // The desktop rail and the mobile sheet hold the same advisor; only one is mounted.
  const desktop = useMedia('(min-width: 1024px)');
  // Shared decisions: the "together" tab shows how many wait for my answer.
  const dec = useDecisions(session.household?.household_id, session.user.id);
  // Answers waiting for me, plus cards with new messages in their conversation.
  const badges = { together: dec.status === 'ready' ? pendingCount(dec.decisions, dec.votes, session.user.id, Object.keys(data.members || {})) + unreadTotal(dec.decisions, dec.messages || [], session.user.id, (id) => seenAt(id, session.user.id)) : 0 };
  // A new message from the partner while the app is open: a banner, unless that conversation is on the screen.
  useEffect(() => onIncoming((m) => {
    if (document.querySelector('.wa') || document.visibilityState !== 'visible') return;
    const who = m.role === 'ai' ? '🤖 היועץ' : (data.members || {})[m.author_id] || 'בן/בת הזוג';
    if (navigator.vibrate) navigator.vibrate(30);
    showToast('💬 ' + who + ': ' + String(m.text).split('\n')[0].slice(0, 80), { undo: () => { location.hash = '#/together/' + m.decision_id; }, label: 'לפתוח', ms: 6000 });
  }), [data.members]);

  const profile = {
    name: session.household?.display_name || session.user.email.split('@')[0],
    email: session.user.email,
    initials: initials(session.household?.display_name, session.user.email)
  };
  // No saved choice means "follow the system".
  const effectiveTheme = theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const toggleTheme = () => {
    const next = effectiveTheme === 'light' ? 'dark' : 'light';
    setTheme(next); writeLocal('theme', next); applyTheme(next);
  };
  // Home-screen shortcuts (manifest): /app/?action=add|voice|ask|talk opens
  // that action at once; the parameter is taken off the address.
  useEffect(() => {
    const action = new URLSearchParams(location.search).get('action');
    if (!action) return;
    history.replaceState(null, '', location.pathname + location.hash);
    track('shortcut');
    if (!session.household) return;
    if (action === 'add' || action === 'voice' || action === 'talk') setOverlay(action);
    else if (action === 'ask') {
      if (desktop) setTimeout(() => document.querySelector('.rail input[aria-label="שאלה ליועץ"]')?.focus(), 300);
      else setOverlay('advisor');
    }
  }, []);
  // Opening the app: counted once per launch (who comes back).
  useEffect(() => { track('app_open'); }, []);
  // Desktop shortcuts: N add, U import, / ask the advisor, 1-5 tabs.
  useEffect(() => {
    if (!desktop) return undefined;
    const onKey = (e) => {
      if (overlay || document.querySelector('.sheet')) return;
      const action = shortcut({ code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, typing: isTyping(e.target) });
      if (!action) return;
      e.preventDefault();
      if (action === 'add') setOverlay('add');
      else if (action === 'import' && session.household) setOverlay('import');
      else if (action === 'advisor') document.querySelector('.rail input[aria-label="שאלה ליועץ"]')?.focus();
      else if (action.startsWith('tab:')) location.hash = hrefFor(action.slice(4));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [desktop, overlay, session.household]);
  const Screen = SCREENS[tab];
  const title = TABS.find((t) => t.key === tab).label;
  const close = () => setOverlay(null);

  return html`
    <div class="shell">
      <${Sidebar} tab=${tab} badges=${badges} profile=${profile} onAdd=${() => setOverlay('add')} onImport=${session.household ? () => setOverlay('import') : null} onLearn=${() => setOverlay('learn')} onProfile=${() => setOverlay('profile')} />
      <main class="shell-main">
        <header class="topbar">
          <div class="topbar-title"><small>${dateLabel(new Date())}${data.refreshing && data.status === 'ready' ? html` <span class="refreshing" role="status"><span class="spinner" aria-hidden="true"></span> מתעדכן…</span>` : ''}</small><h1>${title}</h1></div>
          <div class="topbar-actions">
            <button type="button" class="icon-btn only-mobile" aria-label="פרופיל והגדרות" onClick=${() => setOverlay('profile')}>${profile.initials}</button>
          </div>
        </header>
        ${session.household ? html`<${Screen} key=${tab} data=${data} dec=${dec} onAdd=${() => setOverlay('add')} onImport=${() => setOverlay('import')} onLearn=${() => setOverlay('learn')} userId=${session.user.id} />`
          : html`<${SoonCard} stage="חשבון" title="עוד לא מחוברים למשק בית" items=${['פתחו את הגרסה הנוכחית פעם אחת כדי ליצור משק בית או להצטרף להזמנה, ואז חזרו לכאן']} />`}
      </main>
      ${desktop && html`<${AdvisorRail} data=${data} session=${session} screen=${tab} />`}
      <button type="button" class="ask-fab" onClick=${() => setOverlay('advisor')}><span class="orb"><${Icon} name="spark" size=${18} stroke=${2.2} /></span>שאל את היועץ</button>
      <${BottomNav} tab=${tab} badges=${badges} onAdd=${() => setOverlay('add')} />

      ${overlay === 'profile' && html`<${ProfileSheet} profile=${profile} hid=${session.household ? session.household.household_id : null} userId=${session.user.id} theme=${effectiveTheme} onTheme=${toggleTheme} onSignOut=${session.signOut} onClose=${close} />`}
      ${(overlay === 'add' || overlay === 'voice') && session.household && html`<${AddSheet} data=${data} onClose=${close} onImport=${() => setOverlay('import')} startVoice=${overlay === 'voice'} />`}
      ${overlay === 'talk' && html`<${Sheet} title="שיחה קולית עם היועץ" onClose=${close}>
        ${session.household && data.status === 'ready' ? html`<${AdvisorPanel} data=${data} session=${session} screen=${tab} startTalk=${true} />` : html`<${Loading} />`}
      <//>`}
      ${overlay === 'learn' && html`<${LearnSheet} userId=${session.user.id} householdId=${session.household ? session.household.household_id : null} data=${session.household && data.status === 'ready' ? data : null} onClose=${close} />`}
      ${overlay === 'import' && session.household && data.status === 'ready' && html`<${ImportSheet} data=${data} onClose=${close} />`}
      ${overlay === 'advisor' && !desktop && html`<${Sheet} title="היועץ" onClose=${close}>
        ${session.household && data.status === 'ready' ? html`<${AdvisorPanel} data=${data} session=${session} screen=${tab} />` : html`<${Loading} />`}
      <//>`}
      <${ToastHost} />
    </div>`;
}
