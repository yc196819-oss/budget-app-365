// The app logo: a golden leather wallet with the shekel stamped into it and
// banknotes peeking out: "our money, in one place". Illustrated with depth
// (gradients, a soft shadow, a little shine) on the app's espresso dark.
// One source for the SVG files and the PNG icons.
// The files are named wallet* (not icon*) so phones and browsers that kept
// the previous icon fetch the new one.
// Run: node scripts/logo.mjs (needs Playwright).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// The shekel sign drawn as its two interlocking strokes (no fonts).
const shekel = (x, y, s, color, w, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}><path d="M10 92 V14 H52 Q66 14 66 28 V66"/><path d="M90 8 V86 H48 Q34 86 34 72 V34"/></g>`;
// Stamped into the leather: a light edge under a dark groove.
const stamped = (x, y, s, w) => shekel(x + 2.5, y + 3.5, s, '#FFF1D2', w, 'opacity=".7"') + shekel(x, y, s, '#8E4F14', w);
const sparkle = (x, y, r) => `<path d="M${x} ${y - r} Q${x + r * .18} ${y - r * .18} ${x + r} ${y} Q${x + r * .18} ${y + r * .18} ${x} ${y + r} Q${x - r * .18} ${y + r * .18} ${x - r} ${y} Q${x - r * .18} ${y - r * .18} ${x} ${y - r} Z" fill="#FFF3D6"/>`;

// The wallet, centered on 256,256 at the given scale.
export function mark(scale = 1) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `<g id="wallet" transform="${t}">
    <ellipse cx="256" cy="426" rx="170" ry="18" fill="#000" opacity=".5" filter="url(#soft)"/>
    <g filter="url(#shadow)">
      <rect x="150" y="104" width="190" height="130" rx="10" fill="url(#bill)" transform="rotate(-10 245 170)"/>
      <rect x="186" y="96" width="190" height="130" rx="10" fill="url(#bill)" transform="rotate(6 280 160)"/>
      <circle cx="282" cy="150" r="26" fill="none" stroke="#C9B08A" stroke-width="6" transform="rotate(6 280 160)"/>
      <rect x="86" y="176" width="340" height="226" rx="38" fill="url(#leather)"/>
      <path d="M120 184 H392" stroke="#FFF3DC" stroke-opacity=".18" stroke-width="6" stroke-linecap="round"/>
      <rect x="100" y="190" width="312" height="198" rx="28" fill="none" stroke="#7E4512" stroke-opacity=".6" stroke-width="4" stroke-dasharray="12 9"/>
      <path d="M310 240 H426 V340 H310 Q286 340 286 316 V264 Q286 240 310 240 Z" fill="#C47828"/>
      <circle cx="326" cy="290" r="18" fill="#2A1E15"/>
      ${stamped(140, 236, 0.9, 16)}
    </g>
    ${sparkle(410, 120, 20)}${sparkle(110, 140, 12)}
  </g>`;
}

const defs = `<defs>
    <radialGradient id="bg" cx=".5" cy=".28" r=".85"><stop offset="0" stop-color="#3B2C1F"/><stop offset=".6" stop-color="#1D1510"/><stop offset="1" stop-color="#0E0A08"/></radialGradient>
    <radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#F2B66D" stop-opacity=".38"/><stop offset="1" stop-color="#F2B66D" stop-opacity="0"/></radialGradient>
    <radialGradient id="leather" cx=".34" cy=".28" r=".85"><stop offset="0" stop-color="#FFF0CF"/><stop offset=".35" stop-color="#F8C678"/><stop offset=".8" stop-color="#D98B33"/><stop offset="1" stop-color="#B8691F"/></radialGradient>
    <linearGradient id="bill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBF4E8"/><stop offset="1" stop-color="#E3D3BC"/></linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#000" flood-opacity=".6"/></filter>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>`;

export const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs}
  <rect width="512" height="512" rx="116" fill="url(#bg)"/>
  <circle cx="256" cy="250" r="210" fill="url(#glow)"/>
  ${mark(1)}
</svg>
`;

// Maskable: full-bleed background, the mark inside the safe circle.
export const MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs}
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="256" cy="250" r="210" fill="url(#glow)"/>
  ${mark(0.76)}
</svg>
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, 'wallet.svg'), ICON);
  writeFileSync(join(root, 'wallet-maskable.svg'), MASKABLE);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  const shots = [['wallet-180.png', ICON, 180], ['wallet-192.png', ICON, 192], ['wallet-512.png', ICON, 512], ['wallet-maskable-192.png', MASKABLE, 192], ['wallet-maskable-512.png', MASKABLE, 512]];
  for (const [file, svg, size] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: join(root, file), omitBackground: true });
  }
  await browser.close();
  console.log('logo written');
}
