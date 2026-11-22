// Design guard: counts colours written straight into the CSS (hex, rgb(),
// rgba(), hsl(), hsla()) instead of coming from tokens.css, and fails if any
// file has more than its recorded baseline. The baseline can only go down.
//
// Run:            npm run design:check
// After cleanup:  npm run design:check -- --update   (lowers the baseline)
//
// Only declaration values are counted, so an id selector like #add is not
// mistaken for a colour, and comments are ignored.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CSS_ROOT = join(repo, 'public', 'app');
export const BASELINE_FILE = join(repo, 'scripts', 'design-baseline.json');
// The one place colours are allowed to be written as raw values.
export const TOKENS_FILE = 'public/app/styles/tokens.css';

const HEX = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g;
const FUNC = /\b(?:rgba?|hsla?)\(/gi;

// Count raw colours in one stylesheet's text.
export function countColors(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let hex = 0, func = 0;
  // Innermost {...} blocks hold the declarations (also inside @media/@keyframes).
  for (const [, body] of text.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const value = decl.slice(i + 1);
      hex += (value.match(HEX) || []).length;
      func += (value.match(FUNC) || []).length;
    }
  }
  return { hex, func, total: hex + func };
}

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

// Current counts per file, keyed by repo-relative path with forward slashes.
export function measure(root = CSS_ROOT) {
  const counts = {};
  for (const file of cssFiles(root).sort()) {
    const key = relative(repo, file).split(sep).join('/');
    if (key === TOKENS_FILE) continue;
    const { total } = countColors(readFileSync(file, 'utf8'));
    if (total > 0) counts[key] = total;
  }
  return counts;
}

// Compare against the baseline. Returns the list of files that went up.
export function compare(current, baseline) {
  const worse = [];
  for (const [file, n] of Object.entries(current)) {
    const allowed = baseline[file] ?? 0;
    if (n > allowed) worse.push({ file, allowed, now: n });
  }
  return worse;
}

function main() {
  const update = process.argv.includes('--update');
  const first = !existsSync(BASELINE_FILE);
  const baseline = first ? {} : JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).files;
  const current = measure();
  // The very first --update records today's numbers; after that it can only lower them.
  const worse = first && update ? [] : compare(current, baseline);
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

  for (const [file, n] of Object.entries(current)) console.log(`${String(n).padStart(5)}  ${file}`);
  console.log(`${String(sum(current)).padStart(5)}  total raw colours outside ${TOKENS_FILE} (baseline ${sum(baseline)})`);

  if (worse.length) {
    console.error('\nNew raw colours found. Use a token from tokens.css instead (var(--accent), var(--muted), ...):');
    for (const w of worse) console.error(`  ${w.file}: ${w.allowed} -> ${w.now}`);
    process.exit(1);
  }
  if (update) {
    writeFileSync(BASELINE_FILE, JSON.stringify({
      note: 'Raw colours (hex/rgb/hsl) per CSS file outside tokens.css. May only go down. Update with: npm run design:check -- --update',
      files: current,
    }, null, 2) + '\n');
    console.log('Baseline updated.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
