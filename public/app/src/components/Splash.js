import { html } from '../lib/html.js';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { readLocal, writeLocal } from '../lib/storage.js';

// The opening screen: while the app loads, a picture is drawn line by line
// in front of the person, then comes to life (windows light up, a plant
// grows, coins drop into a wallet). Three pictures take turns, one per
// opening. With reduced motion the finished picture shows at once.

export const ARTS = ['house', 'plant', 'wallet'];
const LINES = {
  house: 'מסדרים את הבית…',
  plant: 'החיסכון שלכם צומח…',
  wallet: 'עוד רגע…'
};

// Which picture this time: the next one after the last opening. Chosen once
// per page load, so it does not jump while the app loads.
export function nextArt(last) {
  const i = ARTS.indexOf(last);
  return ARTS[(i + 1) % ARTS.length];
}
let chosen = null;
// The first moment the picture was shown on this page load. When the screen
// changes under it (signing in done, the data still loading), the picture
// carries on from where it was instead of starting over.
let firstShown = null;
function art() {
  if (!chosen) {
    chosen = nextArt(readLocal('splash:last', ''));
    writeLocal('splash:last', chosen);
  }
  return chosen;
}

const coin = (cx, cy, r, cls = '') => html`<g class=${'sp-coin ' + cls}><circle cx=${cx} cy=${cy} r=${r} class="sp-fill-coin" /><circle cx=${cx} cy=${cy} r=${r} class="sp-line" pathLength="1" /></g>`;

function House() {
  return html`<svg viewBox="0 0 190 170" width="190" height="170" aria-hidden="true">
    <ellipse cx="95" cy="158" rx="80" ry="7" class="sp-shadow" />
    <rect x="38" y="76" width="114" height="78" rx="8" class="sp-fill sp-walls" />
    <rect x="128" y="34" width="16" height="34" rx="3" class="sp-fill sp-chimney" />
    <circle class="sp-smoke" cx="136" cy="28" r="7" />
    <circle class="sp-drop" cx="136" cy="14" r="8" />
    <rect x="38" y="76" width="114" height="78" rx="8" class="sp-line" pathLength="1" />
    <path d="M128 60 V34 H144 V60" class="sp-line sp-l2" pathLength="1" />
    <path d="M22 80 L95 22 L168 80" class="sp-line sp-roof" pathLength="1" />
    <rect x="84" y="114" width="22" height="40" rx="5" class="sp-fill sp-door" />
    <rect x="84" y="114" width="22" height="40" rx="5" class="sp-line sp-l3" pathLength="1" />
    ${[[52, 90], [112, 90], [52, 122], [112, 122]].map(([x, y], i) => html`<rect key=${i} x=${x} y=${y} width="26" height="22" rx="4" class=${'sp-win sp-w' + i} pathLength="1" />`)}
  </svg>`;
}

function Plant() {
  return html`<svg viewBox="0 0 170 180" width="170" height="180" aria-hidden="true">
    <ellipse cx="85" cy="168" rx="60" ry="6" class="sp-shadow" />
    <path d="M46 126 H124 L114 166 H56 Z" class="sp-fill sp-pot" />
    <path d="M46 126 H124 L114 166 H56 Z" class="sp-line" pathLength="1" />
    <rect x="40" y="118" width="90" height="14" rx="5" class="sp-line sp-l2" pathLength="1" />
    ${coin(66, 120, 7, 'sp-c1')}${coin(104, 120, 7, 'sp-c2')}
    <path d="M85 118 C85 96 80 78 88 46" class="sp-stem" pathLength="1" />
    <g class="sp-sway">
      <path class="sp-leaf sp-f0" d="M84 104 C66 100 58 88 60 80 C72 80 82 90 84 104Z" />
      <path class="sp-leaf sp-f1" d="M86 92 C104 88 112 76 110 68 C98 68 88 78 86 92Z" />
      <path class="sp-leaf sp-f2" d="M84 74 C70 70 64 60 66 54 C76 54 84 62 84 74Z" />
      <path class="sp-leaf sp-f3" d="M87 62 C100 58 106 50 104 44 C94 44 88 52 87 62Z" />
      ${coin(88, 40, 9, 'sp-bud')}
    </g>
  </svg>`;
}

function Wallet() {
  return html`<svg viewBox="0 0 190 160" width="190" height="160" aria-hidden="true">
    <ellipse cx="93" cy="150" rx="70" ry="6" class="sp-shadow" />
    ${coin(66, 30, 11, 'sp-hop sp-h0')}${coin(92, 22, 11, 'sp-hop sp-h1')}${coin(118, 30, 11, 'sp-hop sp-h2')}
    <path d="M30 60 Q30 44 46 44 H140 Q156 44 156 60 V122 Q156 138 140 138 H46 Q30 138 30 122 Z" class="sp-fill sp-wallet" />
    <path d="M30 60 Q30 44 46 44 H140 Q156 44 156 60 V122 Q156 138 140 138 H46 Q30 138 30 122 Z" class="sp-line" pathLength="1" />
    <path d="M120 78 H162 V106 H120 Q108 106 108 92 Q108 78 120 78 Z" class="sp-fill sp-clasp" />
    <path d="M120 78 H162 V106 H120 Q108 106 108 92 Q108 78 120 78 Z" class="sp-line sp-l2" pathLength="1" />
    <circle cx="126" cy="92" r="4" class="sp-dot" />
  </svg>`;
}

const PICS = { house: House, plant: Plant, wallet: Wallet };

export function Splash({ label = 'טוען…', which }) {
  const a = which && PICS[which] ? which : art();
  const Pic = PICS[a];
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !el.getAnimations || !document.timeline) return;
    if (firstShown === null) { firstShown = document.timeline.currentTime; return; }
    for (const anim of el.getAnimations({ subtree: true })) {
      try { anim.startTime = firstShown; } catch (_e) { /* not every browser allows it */ }
    }
  }, []);
  return html`<div class="splash-host"><div ref=${ref} class=${'splash loading sp-' + a} role="status" aria-busy="true" data-art=${a}>
    <span class="sr-only">${label}</span>
    <div class="splash-pic"><${Pic} /></div>
    <div class="splash-word">התקציב שלנו</div>
    <div class="splash-sub" aria-hidden="true">${LINES[a]}</div>
  </div></div>`;
}
