import { installMode, isIOS, isMobile } from '../src/domain/install.js';

// The public download page: one button that installs where the browser can
// (Android Chrome, desktop Chrome/Edge), the two steps on iPhone, and the
// link to open on the phone when viewed on a computer.
// Once the app is on Google Play, put its address here and the badge shows.
const PLAY_URL = '';

const $ = (id) => document.getElementById(id);
let deferred = null;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

function env() {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints || 0;
  return {
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    ios: isIOS(ua, touch), hasPrompt: !!deferred, mobile: isMobile(ua, touch), android: /Android/i.test(ua)
  };
}

function render(show = null) {
  const e = env();
  const mode = installMode(e);
  $('installed').hidden = !e.standalone;
  $('install-btn').hidden = e.standalone;
  for (const id of ['steps-ios', 'steps-android', 'steps-desktop']) $(id).hidden = id !== show;
  if (PLAY_URL && e.android) { $('play').href = PLAY_URL; $('play').hidden = false; }
  return mode;
}

$('url').textContent = location.origin + '/download';
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.origin + '/download'); $('copy').textContent = '✓ הועתק'; } catch (_err) { /* select it by hand */ }
});
$('install-btn').addEventListener('click', async () => {
  const e = env();
  if (deferred) {
    const ev = deferred;
    deferred = null;
    ev.prompt();
    const choice = await ev.userChoice.catch(() => null);
    if (choice && choice.outcome === 'accepted') { $('install-btn').hidden = true; $('installed').hidden = false; }
    return;
  }
  if (PLAY_URL && e.android) { location.href = PLAY_URL; return; }
  render(e.ios ? 'steps-ios' : e.mobile ? 'steps-android' : 'steps-desktop');
});

window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); deferred = ev; render(); });
window.addEventListener('appinstalled', () => { deferred = null; $('install-btn').hidden = true; $('installed').hidden = false; });
render();
