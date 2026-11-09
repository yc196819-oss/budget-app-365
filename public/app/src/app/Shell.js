import { html } from '../lib/html.js';
import { partnerWord, genderOf } from '../domain/people.js';
import { track, setScreen } from '../lib/telemetry.js';
import { Loading } from '../components/Loading.js';
import { useEffect, useState } from 'preact/hooks';
import { tabLabel } from '../domain/routes.js';
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
import { ShopScreen } from '../screens/shop/ShopScreen.js';
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
import { PictureSheet } from '../screens/picture/Picture.js';
import { CONFIG } from '../config.js';
import { LearnSheet } from '../screens/learn/LearnSheet.js';
import { ToastHost } from '../components/ToastHost.js';
import { useHousehold } from '../data/useHousehold.js';
import { useMedia } from '../lib/useMedia.js';
import { AdvisorPanel } from '../screens/advisor/AdvisorPanel.js';
import { claimRef } from '../data/share.js';
import { parseGo, go } from '../lib/go.js';
import { useFeedbackUnread } from '../data/feedback.js';
import { GO_TARGETS } from '../content/howto.js';

const SCREENS = { home: HomeScreen, money: MoneyScreen, together: TogetherScreen, shop: ShopScreen, plans: PlansScreen, assets: AssetsScreen };

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function Shell({ tab, session }) {
  setScreen(tab);
  // One overlay at a time: 'profile' | 'add' | 'voice' | 'import' | 'learn' | 'advisor' | 'talk' | null.
  const [overlay, setOverlay] = useState(null);
  // The account or card an upload is for, when it was started from one.
  const [importFor, setImportFor] = useState(null);
  const openImport = (src) => { setImportFor(src && src.id ? src : null); setOverlay('import'); };
  // Opened as the advisor's own window (desktop): only the conversation.
  const [solo, setSolo] = useState(() => /^#\/advisor/.test(location.hash));
  useEffect(() => {
    const on = () => setSolo(/^#\/advisor/.test(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // "Take me there" (the advisor's instant answers): a sheet, or a tab and
  // view, opened fresh (the screen is remounted to read its view).
  const [profileView, setProfileView] = useState('main');
  // Answers to my requests I have not opened yet.
  const answers = useFeedbackUnread(session.user.id);
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    const on = (e) => {
      // The advisor's own window has no screens: the app opens in another tab, there.
      if (/^#\/advisor/.test(location.hash)) { window.open(location.pathname + '?go=' + encodeURIComponent(e.detail) + '#/home', '_blank'); return; }
      const g = parseGo(e.detail);
      if (g.overlay) { setProfileView(g.view || 'main'); setOverlay(g.overlay); return; }
      setOverlay(null);
      location.hash = g.hash;
      setVisit((n) => n + 1);
    };
    window.addEventListener('app:go', on);
    return () => window.removeEventListener('app:go', on);
  }, []);
  const [theme, setTheme] = useState(() => readLocal('theme', ''));
  const data = useHousehold(session.household?.household_id, session.user.id);
  // The desktop rail and the mobile sheet hold the same advisor; only one is mounted.
  const desktop = useMedia('(min-width: 1024px)');
  // On a narrower computer screen the menu shrinks to icons and the advisor
  // waits behind a button, so the screen itself keeps room. Either can be
  // changed by hand, and the choice is remembered.
  const roomForRail = useMedia('(min-width: 1440px)');
  const roomForNav = useMedia('(min-width: 1180px)');
  const [navPref, setNavPref] = useState(() => readLocal('nav:mini', ''));
  // The advisor on a computer: 'side' (always open next to the screen),
  // 'float' (a small window that can be minimized to the button and brought
  // back) or 'button' (opens over the screen). Chosen once, remembered.
  const [modePref, setModePref] = useState(() => readLocal('advisor:mode', '') || (readLocal('rail:on', '') === '1' ? 'side' : readLocal('rail:on', '') === '0' ? 'button' : ''));
  const [floatOpen, setFloatOpen] = useState(false);
  const navMini = navPref ? navPref === '1' : !roomForNav;
  const advisorMode = modePref || (roomForRail ? 'side' : 'float');
  const railOn = desktop && advisorMode === 'side';
  const floating = desktop && advisorMode === 'float';
  const setMini = (on) => { const v = on ? '1' : '0'; writeLocal('nav:mini', v); setNavPref(v); };
  const setMode = (m) => { writeLocal('advisor:mode', m); setModePref(m); setOverlay((o) => (o === 'advisor' ? null : o)); setFloatOpen(m === 'float'); };
  const openAdvisor = () => (floating ? setFloatOpen(true) : setOverlay('advisor'));
  const askAdvisor = () => {
    if (railOn) { document.querySelector('.rail [aria-label="שאלה ליועץ"]')?.focus(); return; }
    openAdvisor();
    setTimeout(() => document.querySelector('.adv-float [aria-label="שאלה ליועץ"], .sheet [aria-label="שאלה ליועץ"]')?.focus(), 350);
  };
  // Shared decisions: the "together" tab shows how many wait for my answer.
  const dec = useDecisions(session.household?.household_id, session.user.id);
  // Answers waiting for me, plus cards with new messages in their conversation.
  const badges = { together: dec.status === 'ready' ? pendingCount(dec.decisions, dec.votes, session.user.id, Object.keys(data.members || {})) + unreadTotal(dec.decisions, dec.messages || [], session.user.id, (id) => seenAt(id, session.user.id)) : 0 };
  // A new message from the partner while the app is open: a banner, unless that conversation is on the screen.
  useEffect(() => onIncoming((m) => {
    if (document.querySelector('.wa') || document.visibilityState !== 'visible') return;
    const who = m.role === 'ai' ? 'היועץ' : (data.members || {})[m.author_id] || partnerWord(genderOf(data.genders, m.author_id));
    if (navigator.vibrate) navigator.vibrate(30);
    showToast('' + who + ': ' + String(m.text).split('\n')[0].slice(0, 80), { undo: () => { location.hash = '#/together/' + m.decision_id; }, label: 'לפתוח', ms: 6000 });
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
  // Came from a friend's link: counted once, now that this person is signed in.
  useEffect(() => { claimRef(session.user && session.user.user_metadata && session.user.user_metadata.ref); }, []);
  // Home-screen shortcuts (manifest): /app/?action=add|voice|ask|talk opens
  // that action at once; the parameter is taken off the address.
  useEffect(() => {
    const target = new URLSearchParams(location.search).get('go');
    if (target && GO_TARGETS[target]) {
      history.replaceState(null, '', location.pathname + location.hash);
      setTimeout(() => go(target), 0);
      return;
    }
    const action = new URLSearchParams(location.search).get('action');
    if (!action) return;
    history.replaceState(null, '', location.pathname + location.hash);
    track('shortcut');
    if (!session.household) return;
    if (action === 'add' || action === 'voice' || action === 'talk') setOverlay(action);
    else if (action === 'ask') {
      if (railOn) setTimeout(() => document.querySelector('.rail [aria-label="שאלה ליועץ"]')?.focus(), 300);
      else openAdvisor();
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
      else if (action === 'advisor') askAdvisor();
      else if (action.startsWith('tab:')) location.hash = hrefFor(action.slice(4));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [desktop, overlay, session.household, railOn, floating]);
  if (solo) {
    return html`<main class="advisor-solo" aria-label="היועץ">
      <header class="rail-head">
        <span class="orb"><${Icon} name="spark" size=${19} stroke=${2.2} /></span>
        <span style="display:flex;flex-direction:column"><b style="font-size:17px">היועץ</b><span class="muted" style="font-size:12px">מכיר את המספרים שלכם</span></span>
      </header>
      ${session.household && data.status === 'ready' ? html`<${AdvisorPanel} data=${data} session=${session} screen="home" />` : html`<${Loading} />`}
      <${ToastHost} />
    </main>`;
  }
  const Screen = SCREENS[tab];
  const title = tabLabel(tab);
  const close = () => setOverlay(null);

  return html`
    <div class=${'shell' + (desktop && navMini ? ' nav-mini' : '') + (desktop && !railOn ? ' no-rail' : '') + (floating && floatOpen ? ' float-open' : '')}>
      <${Sidebar} mini=${navMini} onMini=${() => setMini(!navMini)} tab=${tab} badges=${{ ...badges, profile: answers }} profile=${profile} onAdd=${() => setOverlay('add')} onImport=${session.household ? () => openImport(null) : null} onLearn=${() => setOverlay('learn')} onProfile=${() => { setProfileView('main'); setOverlay('profile'); }} />
      <main class="shell-main">
        <header class="topbar">
          <div class="topbar-title"><small>${dateLabel(new Date())}${data.refreshing && data.status === 'ready' ? html` <span class="refreshing" role="status"><span class="spinner" aria-hidden="true"></span> מתעדכן…</span>` : ''}</small><h1>${title}</h1></div>
          <div class="topbar-actions">
            <button type="button" class="icon-btn only-mobile" aria-label=${answers > 0 ? 'פרופיל והגדרות, יש תשובה לפנייה שלך' : 'פרופיל והגדרות'} style="position:relative" onClick=${() => { setProfileView('main'); setOverlay('profile'); }}>${profile.initials}${answers > 0 && html`<span class="fb-dot" aria-hidden="true">${answers}</span>`}</button>
          </div>
        </header>
        ${session.household ? html`<${Screen} key=${tab + ':' + visit} data=${data} dec=${dec} onAdd=${() => setOverlay('add')} owner=${CONFIG.adminEmails.includes(String(session.user.email || '').toLowerCase())} onImport=${openImport} onPicture=${() => setOverlay('picture')} onLearn=${() => setOverlay('learn')} onAsk=${askAdvisor} userId=${session.user.id} />`
          : html`<${SoonCard} stage="חשבון" title="עוד לא מחוברים למשק בית" items=${['פתחו את הגרסה הנוכחית פעם אחת כדי ליצור משק בית או להצטרף להזמנה, ואז חזרו לכאן']} />`}
      </main>
      ${railOn && html`<${AdvisorRail} data=${data} session=${session} screen=${tab} onFloat=${() => setMode('float')} onHide=${() => setMode('button')} />`}
      ${floating && floatOpen && html`<${AdvisorRail} floating=${true} data=${data} session=${session} screen=${tab} onPin=${() => setMode('side')} onMinimize=${() => setFloatOpen(false)} />`}
      <button type="button" class="ask-fab" onClick=${openAdvisor}><span class="orb"><${Icon} name="spark" size=${18} stroke=${2.2} /></span>שאל את היועץ</button>
      <${BottomNav} tab=${tab} badges=${badges} onAdd=${() => setOverlay('add')} />

      ${overlay === 'profile' && html`<${ProfileSheet} answers=${answers} start=${profileView} profile=${profile} hid=${session.household ? session.household.household_id : null} userId=${session.user.id} theme=${effectiveTheme} onTheme=${toggleTheme} onSignOut=${session.signOut} onClose=${close} />`}
      ${(overlay === 'add' || overlay === 'voice') && session.household && html`<${AddSheet} data=${data} onClose=${close} onImport=${() => openImport(null)} startVoice=${overlay === 'voice'} />`}
      ${overlay === 'talk' && html`<${Sheet} title="שיחה קולית עם היועץ" onClose=${close}>
        ${session.household && data.status === 'ready' ? html`<${AdvisorPanel} data=${data} session=${session} screen=${tab} startTalk=${true} />` : html`<${Loading} />`}
      <//>`}
      ${overlay === 'learn' && html`<${LearnSheet} userId=${session.user.id} householdId=${session.household ? session.household.household_id : null} data=${session.household && data.status === 'ready' ? data : null} onClose=${close} />`}
      ${overlay === 'import' && session.household && data.status === 'ready' && html`<${ImportSheet} key=${importFor ? importFor.id : 'any'} data=${data} source=${importFor} onClose=${close} />`}
      ${overlay === 'picture' && session.household && data.status === 'ready' && html`<${PictureSheet} data=${data} onClose=${close} onUpload=${openImport} />`}
      ${overlay === 'advisor' && !railOn && html`<${Sheet} title="היועץ" onClose=${close}>
        ${desktop && html`<span class="adv-modes"><button type="button" class="btn-text rail-pin" onClick=${() => setMode('side')}>להציג קבוע בצד המסך</button> · <button type="button" class="btn-text float-pin" onClick=${() => setMode('float')}>כחלון צף</button></span>`}
        ${session.household && data.status === 'ready' ? html`<${AdvisorPanel} data=${data} session=${session} screen=${tab} />` : html`<${Loading} />`}
      <//>`}
      <${ToastHost} />
    </div>`;
}
