// The small notification icon (Android "badge"): Android paints it in one
// color from its alpha channel, so a full-color icon shows as a white square.
// This is the app's wallet as a white silhouette on transparent.
// Run: node scripts/badge-icon.mjs (needs Playwright).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs><mask id="m"><rect width="96" height="96" fill="#fff"/>
    <rect x="62" y="44" width="30" height="22" rx="6" fill="#000"/>
    <rect x="21" y="28" width="38" height="6" rx="3" fill="#000" transform="rotate(-10 40 31)"/>
  </mask></defs>
  <g fill="#fff" mask="url(#m)">
    <rect x="24" y="12" width="38" height="26" rx="3" transform="rotate(-10 43 25)"/>
    <rect x="34" y="10" width="38" height="26" rx="3" transform="rotate(6 53 23)"/>
    <rect x="8" y="30" width="80" height="54" rx="10"/>
  </g>
  <rect x="66" y="48" width="22" height="14" rx="4" fill="#fff"/>
  <circle cx="72" cy="55" r="3.5" fill="none"/>
</svg>`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 96, height: 96 } });
  writeFileSync(join(root, 'badge.svg'), BADGE + '\n');
  await page.setContent(`<html><body style="margin:0;background:transparent">${BADGE.replace('<svg ', '<svg width="96" height="96" ')}</body></html>`);
  await page.screenshot({ path: join(root, 'badge-96.png'), clip: { x: 0, y: 0, width: 96, height: 96 }, omitBackground: true });
  await browser.close();
}
