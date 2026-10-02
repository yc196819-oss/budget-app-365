// The app logo: a golden egg in a nest, the family's "nest egg": a home
// that keeps the shared money safe and lets it grow. Warm espresso and amber,
// the app's own palette. One source for the SVG files and the PNG icons.
// Run: node scripts/logo.mjs (needs Playwright).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// The egg and the nest, centered on 256,256 at the given scale.
export function mark(scale = 1) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `<g transform="${t}">
    <path d="M256 104C318 104 352 196 352 258C352 312 309 348 256 348C203 348 160 312 160 258C160 196 194 104 256 104Z" fill="url(#egg)"/>
    <path d="M256 104C318 104 352 196 352 258C352 312 309 348 256 348C203 348 160 312 160 258C160 196 194 104 256 104Z" fill="url(#eggShade)"/>
    <ellipse cx="218" cy="176" rx="16" ry="31" transform="rotate(-22 218 176)" fill="#FFFBF2" fill-opacity=".6"/>
    <path d="M372 120l7 19 19 7-19 7-7 19-7-19-19-7 19-7z" fill="#FFE3A8"/>
    <path d="M150 156l4 11 11 4-11 4-4 11-4-11-11-4 11-4z" fill="#FFE3A8" fill-opacity=".7"/>
    <path d="M96 262L126 292M416 262L386 292M104 300L132 306M408 300L380 306" stroke="#CFAE87" stroke-width="10" stroke-linecap="round"/>
    <path d="M112 284C124 382 196 414 256 414C316 414 388 382 400 284C364 330 312 350 256 350C200 350 148 330 112 284Z" fill="url(#nest)"/>
    <path d="M146 326C196 370 316 370 366 326" fill="none" stroke="#9C5C26" stroke-opacity=".45" stroke-width="9" stroke-linecap="round"/>
    <path d="M182 371C226 392 286 392 330 371" fill="none" stroke="#9C5C26" stroke-opacity=".35" stroke-width="9" stroke-linecap="round"/>
  </g>`;
}

const defs = `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2E231B"/><stop offset="1" stop-color="#110D0B"/></linearGradient>
    <linearGradient id="egg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE7A8"/><stop offset=".5" stop-color="#F5B04A"/><stop offset="1" stop-color="#C46F1A"/></linearGradient>
    <radialGradient id="eggShade" cx=".5" cy=".55" r=".6"><stop offset=".72" stop-color="#7A3E0E" stop-opacity="0"/><stop offset="1" stop-color="#7A3E0E" stop-opacity=".35"/></radialGradient>
    <linearGradient id="nest" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3E2C9"/><stop offset="1" stop-color="#D2B48E"/></linearGradient>
  </defs>`;

export const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs}
  <rect width="512" height="512" rx="116" fill="url(#bg)"/>
  ${mark(1)}
</svg>
`;

// Maskable: full-bleed background, the mark inside the safe circle.
export const MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs}
  <rect width="512" height="512" fill="url(#bg)"/>
  ${mark(0.76)}
</svg>
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, 'icon.svg'), ICON);
  writeFileSync(join(root, 'icon-maskable.svg'), MASKABLE);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  const shots = [['icon-180.png', ICON, 180], ['icon-192.png', ICON, 192], ['icon-512.png', ICON, 512], ['icon-maskable-192.png', MASKABLE, 192], ['icon-maskable-512.png', MASKABLE, 512]];
  for (const [file, svg, size] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: join(root, file), omitBackground: true });
  }
  await browser.close();
  console.log('logo written');
}
