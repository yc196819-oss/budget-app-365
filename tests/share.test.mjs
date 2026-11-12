import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the app takes files shared from the phone: spreadsheets, PDFs and pictures, by POST to its own page', () => {
  const m = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));
  const t = m.share_target;
  assert.equal(t.action, '/app/share-target');
  assert.equal(t.method, 'POST');
  assert.equal(t.enctype, 'multipart/form-data');
  const accept = t.params.files[0].accept;
  for (const a of ['.xlsx', '.xls', '.csv', '.pdf', 'image/*']) assert.ok(accept.includes(a), a);
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /\/app\/share-target/);
  assert.match(sw, /k !== SHARED/, 'a new version of the app does not throw away a waiting file');
});

test('a guess from the file name: the card by its last 4 digits, or the only one of that company', async () => {
  const { shareGuess } = await import('../public/app/src/domain/sources.js');
  const sources = [{ id: 'm1', kind: 'card', provider: 'max', last4: '4821' }, { id: 'm2', kind: 'card', provider: 'max', last4: '2928' }, { id: 'c1', kind: 'card', provider: 'cal', last4: '7710' }];
  assert.equal(shareGuess('statement_2928_nov.xlsx', sources), 'm2');
  assert.equal(shareGuess('cal-export.xlsx', sources), 'c1');
  assert.equal(shareGuess('max-export.xlsx', sources), null, 'two Max cards: no guess');
  assert.equal(shareGuess('file.pdf', sources), null);
});
