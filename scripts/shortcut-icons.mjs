// Icons for the home-screen shortcuts (long-press on the app icon, Android):
// add an expense, add by voice, ask the advisor, talk with the advisor.
// A golden disc on the app's espresso dark, one glyph each, no fonts.
// Run: node scripts/shortcut-icons.mjs (needs Playwright).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const INK = '#4A2A0C';
const GLYPHS = {
  add: `<path d="M48 26 V70 M26 48 H70" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`,
  voice: `<rect x="38" y="20" width="20" height="36" rx="10" fill="${INK}"/><path d="M28 46 Q28 66 48 66 Q68 66 68 46 M48 66 V76 M38 76 H58" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`,
  ask: `<path d="M48 18 Q51 45 78 48 Q51 51 48 78 Q45 51 18 48 Q45 45 48 18 Z" fill="${INK}"/><path d="M72 18 Q73 25 80 26 Q73 27 72 34 Q71 27 64 26 Q71 25 72 18 Z" fill="${INK}"/>`,
  talk: `<path d="M20 30 Q20 22 28 22 H60 Q68 22 68 30 V50 Q68 58 60 58 H40 L28 70 V58 Q20 58 20 50 Z" fill="${INK}"/><path d="M74 38 Q80 46 74 54 M80 32 Q90 46 80 60" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`
};

export function svg(glyph) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs><radialGradient id="g" cx=".34" cy=".28" r=".85"><stop offset="0" stop-color="#FFF0CF"/><stop offset=".45" stop-color="#F8C678"/><stop offset="1" stop-color="#D98B33"/></radialGradient></defs>
  <rect width="96" height="96" fill="#13100E"/>
  <circle cx="48" cy="48" r="44" fill="url(#g)"/>
  ${GLYPHS[glyph]}
</svg>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 192, height: 192 } });
  for (const name of Object.keys(GLYPHS)) {
    const s = svg(name);
    writeFileSync(join(root, `shortcut-${name}.svg`), s + '\n');
    await page.setContent(`<html><body style="margin:0">${s.replace('<svg ', '<svg width="192" height="192" ')}</body></html>`);
    await page.screenshot({ path: join(root, `shortcut-${name}.png`), clip: { x: 0, y: 0, width: 192, height: 192 } });
  }
  await browser.close();
}
