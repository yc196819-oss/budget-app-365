// A picture sent to the advisor with a question: checked, then sent to
// Claude before the text. Never stored.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseImage, chatContent, MAX_BASE64, IMAGE_NOTE } = require('../server/advisorImage');
const { claudeRequest } = require('../server/claude');

const tiny = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

test('a JPEG, PNG or WEBP data URL is read', () => {
  assert.deepEqual(parseImage(tiny), { media_type: 'image/jpeg', data: Buffer.from('fake-jpeg-bytes').toString('base64') });
  assert.equal(parseImage(tiny.replace('jpeg', 'png')).media_type, 'image/png');
  assert.equal(parseImage(tiny.replace('jpeg', 'webp')).media_type, 'image/webp');
});

test('anything else is refused with a Hebrew reason', () => {
  for (const bad of ['', null, 'hello', 'data:image/gif;base64,AAAA', 'data:application/pdf;base64,AAAA', 'data:image/jpeg;base64,<script>', 'https://example.com/a.jpg']) {
    const r = parseImage(bad);
    assert.ok(r.error, String(bad));
    assert.match(r.error, /תמונה/);
  }
});

test('a picture over the size limit is refused', () => {
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(MAX_BASE64) + 4);
  assert.equal(parseImage(big).error, 'התמונה גדולה מדי.');
});

test('the picture goes to Claude first, then the question; no picture: plain text', () => {
  assert.equal(chatContent('שאלה', null), 'שאלה');
  const img = parseImage(tiny);
  const { init } = claudeRequest({ key: 'k', model: 'claude-sonnet-5', maxTokens: 10, content: chatContent('שאלה', img), stream: true });
  const body = JSON.parse(init.body);
  const content = body.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.deepEqual(content[0].source, { type: 'base64', media_type: 'image/jpeg', data: img.data });
  assert.deepEqual(content[1], { type: 'text', text: 'שאלה' });
});

test('the advisor is told the picture is not kept and to copy amounts exactly', () => {
  assert.match(IMAGE_NOTE, /לא נשמרת/);
  assert.match(IMAGE_NOTE, /בדיוק/);
});

// Pictures are for everyone, up to 20 an hour per person; only requests that
// carry a picture count. (No check reads req.authEmail: a session the server
// remembers carries none, which broke the owner's first try.)
test('the picture limit counts only requests with a picture', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'budget-ai-server.js'), 'utf8');
  assert.match(src, /app\.post\('\/api\/ai\/advice-chat-stream', requireAuth, aiLimiter, advisorImageLimiter,/);
  const at = src.indexOf('const advisorImageLimiter');
  const lim = src.slice(at, src.indexOf('});', at));
  assert.match(lim, /max: 20/);
  assert.match(lim, /skip: \(req\) => !\(req\.body && req\.body\.image\)/);
  const start = src.indexOf("app.post('/api/ai/advice-chat-stream'");
  assert.doesNotMatch(src.slice(start, src.indexOf('advisorImage.parseImage', start)), /req\.authEmail/);
});
