import test from 'node:test';
import assert from 'node:assert/strict';
import { txEdit, withoutSaved } from '../public/app/src/domain/sources.js';

const TODAY = new Date('2026-11-16T10:00:00Z');
const line = { id: 't1', amount: 120, tx_date: '2026-11-10', description: 'מכולת השכונה', import_id: 'imp1', card_id: 'c1', type: 'expense' };

test('an edit saves only what changed; an imported line keeps what the file said', () => {
  const { patch } = txEdit(line, { amount: '102.5', date: '2026-11-09', description: 'מכולת השכונה' }, TODAY);
  assert.deepEqual(patch, { amount: 102.5, tx_date: '2026-11-09', original: { tx_date: '2026-11-10', amount: 120, description: 'מכולת השכונה' } });
  assert.deepEqual(txEdit(line, { amount: '120', date: '2026-11-10', description: ' מכולת השכונה ' }, TODAY), { patch: null });
  // A second edit keeps the first original.
  const again = txEdit({ ...line, original: { tx_date: '2026-11-10', amount: 120, description: 'x' } }, { amount: '90', date: '2026-11-10', description: 'מכולת השכונה' }, TODAY);
  assert.deepEqual(again.patch, { amount: 90 });
  // Typed by hand: no original.
  assert.deepEqual(txEdit({ ...line, import_id: null }, { amount: '5', date: '2026-11-10', description: 'מכולת השכונה' }, TODAY).patch, { amount: 5 });
});

test('a refund keeps its minus; wrong values are refused in plain Hebrew', () => {
  assert.deepEqual(txEdit({ ...line, amount: -50, import_id: null }, { amount: '40', date: '2026-11-10', description: 'מכולת השכונה' }, TODAY).patch, { amount: -40 });
  assert.equal(txEdit(line, { amount: '0', date: '2026-11-10', description: 'א' }, TODAY).error, 'סכום לא תקין');
  assert.equal(txEdit(line, { amount: '10', date: '2026-13-40', description: 'א' }, TODAY).error, 'תאריך לא תקין');
  assert.equal(txEdit(line, { amount: '10', date: '1990-01-01', description: 'א' }, TODAY).error, 'תאריך לא תקין');
  assert.equal(txEdit(line, { amount: '10', date: '2026-11-10', description: '  ' }, TODAY).error, 'כתבו תיאור');
});

test('the same file uploaded after an edit: the edited line is recognised by its original, not saved again', () => {
  const saved = [{ ...line, amount: 102.5, tx_date: '2026-11-09', original: { tx_date: '2026-11-10', amount: 120, description: 'מכולת השכונה' } }];
  const file = [{ tx_date: '2026-11-10', amount: 120, description: 'מכולת השכונה', card_id: 'c1', type: 'expense' }, { tx_date: '2026-11-11', amount: 30, description: 'מאפייה', card_id: 'c1', type: 'expense' }];
  assert.deepEqual(withoutSaved(file, saved).map((r) => r.description), ['מאפייה']);
});
