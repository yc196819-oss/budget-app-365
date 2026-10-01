// The Claude request the server sends. Current models (Sonnet 5 and later)
// reject temperature/top_p/top_k with a 400, which broke the advisor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { claudeRequest, isRetryable } = require('../server/claude');

test('no sampling parameters are sent to Claude', () => {
  for (const stream of [false, true]) {
    const { init } = claudeRequest({ key: 'k', model: 'claude-sonnet-5', maxTokens: 3000, content: 'שלום', stream });
    const body = JSON.parse(init.body);
    for (const p of ['temperature', 'top_p', 'top_k']) assert.equal(p in body, false, p);
    assert.equal(body.model, 'claude-sonnet-5');
    assert.equal(body.max_tokens, 3000);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'שלום' }]);
    assert.equal(body.stream, stream ? true : undefined);
  }
});

test('the request goes to the Messages API with the key and version headers', () => {
  const { url, init } = claudeRequest({ key: 'secret', model: 'm', maxTokens: 10, content: [{ type: 'text', text: 'x' }] });
  assert.match(url, /\/v1\/messages$/);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-api-key'], 'secret');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
});

test('only transient failures are retried', () => {
  for (const s of [undefined, 0, 408, 429, 500, 529]) assert.equal(isRetryable(s), true, String(s));
  for (const s of [400, 401, 403, 404]) assert.equal(isRetryable(s), false, String(s));
});
