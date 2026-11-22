import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countColors, compare, measure, TOKENS_FILE } from '../scripts/design-check.mjs';
import { readFileSync } from 'node:fs';

test('counts hex and colour functions in declaration values', () => {
  const css = '.a { color: #fff; background: #F2B66D26; border: 1px solid rgba(0,0,0,.2); } .b { fill: hsl(10 20% 30%); }';
  assert.deepEqual(countColors(css), { hex: 2, func: 2, total: 4 });
});

test('ignores id selectors, comments and tokens', () => {
  const css = '/* old: #123456 */ #add, #bad { color: var(--accent); } .c { width: 10px; }';
  assert.equal(countColors(css).total, 0);
});

test('counts inside @media and @keyframes', () => {
  const css = '@media (x) { .a { color: #000; } } @keyframes k { to { fill: #abc; } }';
  assert.equal(countColors(css).total, 2);
});

test('flags a file that went up, and a new file with colours', () => {
  const base = { 'a.css': 3 };
  assert.deepEqual(compare({ 'a.css': 3 }, base), []);
  assert.deepEqual(compare({ 'a.css': 2 }, base), []);
  assert.deepEqual(compare({ 'a.css': 4, 'b.css': 1 }, base), [
    { file: 'a.css', allowed: 3, now: 4 },
    { file: 'b.css', allowed: 0, now: 1 },
  ]);
});

test('the app CSS has no more raw colours than the baseline', () => {
  const current = measure();
  assert.equal(TOKENS_FILE in current, false, 'tokens.css is the one place raw colours belong');
  const baseline = JSON.parse(readFileSync(new URL('../scripts/design-baseline.json', import.meta.url), 'utf8')).files;
  assert.deepEqual(compare(current, baseline), [], 'use a token from tokens.css instead of a new raw colour');
});
