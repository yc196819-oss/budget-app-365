import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oauthErrorText } from '../public/app/src/lib/oauthError.js';

test('back from Google with an error: a plain sentence; nothing when there is no error', () => {
  assert.match(oauthErrorText('?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found'), /לקחה יותר מדי זמן/);
  assert.match(oauthErrorText('?error=bad_oauth_state'), /לחצו שוב/);
  assert.match(oauthErrorText('', '#error=access_denied&error_description=user+cancelled'), /בוטלה/);
  assert.match(oauthErrorText('?error=server_error'), /לא הושלמה/);
  assert.equal(oauthErrorText('?action=import'), '');
  assert.equal(oauthErrorText('', '#/home'), '');
});
