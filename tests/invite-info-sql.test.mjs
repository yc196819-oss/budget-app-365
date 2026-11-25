import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261125000000_baseline.sql', import.meta.url), 'utf8');

test('get_invite_info is closed to people who are not signed in', () => {
  const grants = sql.split('\n').filter((l) => l.startsWith('grant execute on function public.get_invite_info('));
  assert.deepEqual(grants, ['grant execute on function public.get_invite_info(p_code text) to authenticated;']);
  assert.ok(sql.includes('revoke all on function public.get_invite_info(p_code text) from public, anon, authenticated;'));
});
