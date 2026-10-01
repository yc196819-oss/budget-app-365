import { html } from '../lib/html.js';
import { useState } from 'preact/hooks';
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
import { ProfileSheet } from '../screens/profile/ProfileSheet.js';

const SCREENS = { home: HomeScreen, money: MoneyScreen, plans: PlansScreen, assets: AssetsScreen };

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function Shell({ tab, session }) {
  // One overlay at a time: 'profile' | 'add' | 'advisor' | null.
  const [overlay, setOverlay] = useState(null);
  const [theme, setTheme] = useState(() => readLocal('theme', ''));

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
  const Screen = SCREENS[tab];
  const title = TABS.find((t) => t.key === tab).label;
  const close = () => setOverlay(null);

  return html`
    <div class="shell">
      <${Sidebar} tab=${tab} profile=${profile} onAdd=${() => setOverlay('add')} onProfile=${() => setOverlay('profile')} />
      <main class="shell-main">
        <header class="topbar">
          <div class="topbar-title"><small>${dateLabel(new Date())}</small><h1>${title}</h1></div>
          <div class="topbar-actions">
            <button type="button" class="icon-btn only-mobile" aria-label="פרופיל והגדרות" onClick=${() => setOverlay('profile')}>${profile.initials}</button>
          </div>
        </header>
        <${Screen} key=${tab} />
      </main>
      <${AdvisorRail} />
      <button type="button" class="ask-fab" onClick=${() => setOverlay('advisor')}><span class="orb"><${Icon} name="spark" size=${18} stroke=${2.2} /></span>שאל את היועץ</button>
      <${BottomNav} tab=${tab} onAdd=${() => setOverlay('add')} />

      ${overlay === 'profile' && html`<${ProfileSheet} profile=${profile} theme=${effectiveTheme} onTheme=${toggleTheme} onSignOut=${session.signOut} onClose=${close} />`}
      ${overlay === 'add' && html`<${Sheet} title="הוספת הוצאה" onClose=${close}>
        <${SoonCard} stage="שלב 1" title="הוספה מהירה" items=${['הקלדה חופשית: "46 קפה בארומה"', 'הוספה בלחיצה אחת של מה שקונים הכי הרבה', 'צילום קבלה והעלאת פירוט']} />
      <//>`}
      ${overlay === 'advisor' && html`<${Sheet} title="היועץ" onClose=${close}>
        <${SoonCard} stage="שלב 5" title="יועץ שמכיר את המספרים שלכם" items=${['תובנה אחת חשובה לכל מסך', 'תשובות מחושבות, עם כפתורי פעולה', 'שאלה בכתב או בהקלטה']} />
      <//>`}
    </div>`;
}
