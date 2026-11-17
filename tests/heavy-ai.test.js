const test = require('node:test');
const assert = require('node:assert/strict');
const { heavyAiLine, ownerDigestMail } = require('../server/ops');

test('the owner hears about homes past 300 AI actions before anyone is stopped', () => {
  assert.equal(heavyAiLine([]), '');
  assert.match(heavyAiLine([340]), /^בית אחד עבר 300 פעולות AI החודש \(הכי הרבה: 340 מתוך 600\)/);
  assert.match(heavyAiLine([310, 520]), /^2 בתים עברו .*הכי הרבה: 520/);
  const mail = ownerDigestMail({ day: '2026-11-17', summary: 'יום שקט.', items: [], link: 'https://example.test/app/', heavyAi: [450] });
  assert.match(mail.text, /בית אחד עבר 300 פעולות AI/);
  assert.match(mail.html, /בית אחד עבר 300 פעולות AI/);
  assert.doesNotMatch(ownerDigestMail({ day: '2026-11-17', summary: 'יום שקט.', items: [], link: 'https://example.test/app/' }).text, /פעולות AI/);
});
