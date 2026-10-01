// Requests to the Claude Messages API. Kept apart from the server so the
// request shape can be tested without a key or the network.
//
// Current Claude models (Sonnet 5 and later) reject sampling parameters
// (temperature, top_p, top_k) with a 400, so none are sent.

const API_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';

function claudeRequest({ key, model, maxTokens, content, stream = false }) {
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  if (stream) body.stream = true;
  return {
    url: API_URL,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    }
  };
}

// A 4xx other than 408/429 means the request itself is wrong (bad model,
// bad key, bad parameter): retrying the same request only adds waiting.
function isRetryable(status) {
  return !status || status >= 500 || status === 408 || status === 429;
}

module.exports = { claudeRequest, isRetryable };
