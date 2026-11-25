import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase_invite_info_signed_in.sql', import.meta.url), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('get_invite_info is closed to people who are not signed in', () => {
  assert.match(sql, /revoke execute on function public\.get_invite_info\(text\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.get_invite_info\(text\) to authenticated;/);
  assert.doesNotMatch(sql, /to (anon|public)\b/, 'nothing granted back to anon or public');
});
