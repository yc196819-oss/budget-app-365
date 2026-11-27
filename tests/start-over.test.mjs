// Starting over: who may do it, the emails, and the database pieces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ops = require('../server/ops.js');
const root = new URL('..', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20261127120000_start_over.sql', root), 'utf8');
const server = readFileSync(new URL('budget-ai-server.js', root), 'utf8');

test('only an owner may start over', () => {
  assert.deepEqual(ops.startOverHousehold([{ household_id: 'h1', role: 'member' }]), { error: 'not_owner' });
  assert.deepEqual(ops.startOverHousehold([]), { error: 'not_owner' });
  assert.deepEqual(ops.startOverHousehold(null), { error: 'not_owner' });
  assert.deepEqual(ops.startOverHousehold([{ household_id: 'h1', role: 'owner' }, { household_id: 'h2', role: 'member' }]), { household: 'h1' });
});

test('an owner of two households must name one, and only one they own', () => {
  const rows = [{ household_id: 'h1', role: 'owner' }, { household_id: 'h2', role: 'owner' }, { household_id: 'h3', role: 'member' }];
  assert.deepEqual(ops.startOverHousehold(rows), { error: 'which' });
  assert.deepEqual(ops.startOverHousehold(rows, 'h2'), { household: 'h2' });
  assert.deepEqual(ops.startOverHousehold(rows, 'h3'), { error: 'not_owner' });
});

test('the code email says what the code is for', () => {
  const m = ops.codeMail('123456', 'reset');
  assert.match(m.subject, /123456/);
  assert.match(m.subject, /למחיקת כל הנתונים/);
  assert.match(m.text, /10 דקות/);
});

test('the partner email names who did it and the way back, with no markup from the name', () => {
  const m = ops.startOverMail('דנה <b>');
  assert.match(m.text, /^דנה <b> מחק/);
  assert.match(m.text, /להחזיר הכל/);
  assert.match(m.text, /30 יום/);
  assert.ok(!m.html.includes('<b>'));
  assert.match(m.html, /&lt;b&gt;/);
  assert.match(ops.startOverMail('').text, /^מי שפתח את הבית/);
});

test('the migration: only the server runs start_over; members restore their own batch', () => {
  assert.match(sql, /revoke all on function public\.start_over\(uuid, uuid\) from public, anon, authenticated;/);
  assert.ok(!/grant execute on function public\.start_over/.test(sql));
  assert.match(sql, /h not in \(select public\.my_households\(\)\)/);
  assert.match(sql, /p_household in \(select public\.my_households\(\)\)/);
  assert.match(sql, /START_OVER_ONCE_A_DAY/);
  assert.match(sql, /'reset'::text/);
  // Nothing in it removes existing rows outside start_over itself.
  const outside = sql.replace(/create or replace function public\.start_over[\s\S]*?end \$function\$;/, '');
  assert.ok(!/\bdelete from\b/i.test(outside));
  assert.ok(!/\bdrop table\b/i.test(sql));
});

test('every table start_over empties comes back in restore_batch', () => {
  const body = sql.match(/create or replace function public\.start_over[\s\S]*?end \$function\$;/)[0];
  const removed = new Set([...body.matchAll(/delete from public\.(\w+)/g)].map((m) => m[1]));
  removed.delete('card_pending'); // short-lived bank sync rows, not kept in the bin
  const restored = new Set(sql.match(/foreach t in array array\[([\s\S]*?)\]/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1)));
  for (const t of removed) assert.ok(restored.has(t), t + ' is removed but never restored');
});

test('the server checks the reset code itself and never marks the login as passed', () => {
  const block = server.slice(server.indexOf("app.post('/api/household/start-over',"), server.indexOf('// ═══ requests from users'))
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(block.length > 100);
  assert.match(block, /purpose: 'reset'/);
  assert.ok(!/useEmailCode|mfa_email_sessions/.test(block));
  assert.match(block, /START_OVER_WORD/);
  assert.match(block, /rpc\('start_over'/);
  assert.match(server, /app\.post\('\/api\/household\/start-over\/code', requireAuth, mfaMailLimiter/);
  assert.match(server, /app\.post\('\/api\/household\/start-over', requireAuth, mfaTryLimiter/);
});
