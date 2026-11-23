const test = require('node:test');
const assert = require('node:assert/strict');
const { OWN_NUMBERS_RULE, historyText } = require('../server/advisorRules.js');

test('the advisor calculates with the numbers the person gave, and never says it has no data when they gave it', () => {
  assert.match(OWN_NUMBERS_RULE, /חשב עם המספרים שלו/);
  assert.match(OWN_NUMBERS_RULE, /ככרטיס מאזן/);
  assert.match(OWN_NUMBERS_RULE, /@@מאזן:/, 'the balance rule is part of it');
  assert.match(OWN_NUMBERS_RULE, /בלי סכומים כוללים \(האפליקציה מחברת\)/);
  assert.match(OWN_NUMBERS_RULE, /אסור לכתוב "אין לי את הנתונים" או "הנתון היחיד שיש לי"/);
  assert.match(OWN_NUMBERS_RULE, /לא נשקלל/, 'what they said not to count is left out');
});

test('the conversation sent to the AI: the person\'s messages in full, even old ones; older answers shortened', () => {
  const long = 'בחשבון יש מינוס של 1,200 '.repeat(40); // ~1,000 characters of made-up figures
  const h = [{ role: 'user', text: long, author: 'דנה' }];
  for (let i = 0; i < 6; i++) h.push({ role: 'ai', text: 'תשובה '.repeat(150) }, { role: 'user', text: 'עוד שאלה', author: 'דנה' });
  const t = historyText(h).split('\n');
  assert.equal(t.length, 12, 'the last 12 messages');
  const first = historyText([h[0], ...h.slice(1, 11)]).split('\n')[0];
  assert.equal(first, 'דנה: ' + long, 'an old message of the person, in full');
  const oldAnswer = t.find((l) => l.startsWith('יועץ:'));
  assert.equal(oldAnswer.length, 'יועץ: '.length + 400, 'an older answer, shortened');
  assert.equal(t[t.length - 2].length, 'יועץ: '.length + Math.min(2000, 'תשובה '.repeat(150).length), 'a newest answer, in full');
});

test('prompt caching: the rules, then the household\'s data, each cached; the turn and a picture after, never cached', () => {
  const { cachedContent, inputTokens } = require('../server/advisorRules.js');
  const c = cachedContent({ rules: 'כללים', data: 'נתונים של בית א', turn: 'השאלה' });
  assert.deepEqual(c.map((b) => b.type), ['text', 'text', 'text']);
  assert.deepEqual(c.map((b) => b.text), ['כללים', 'נתונים של בית א', 'השאלה']);
  assert.deepEqual(c[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(c[1].cache_control, { type: 'ephemeral' });
  assert.equal(c[2].cache_control, undefined, 'the question is not cached');
  const withPic = cachedContent({ rules: 'כללים', data: 'נתונים', turn: 'מה בתמונה?' }, { media_type: 'image/png', data: 'AAAA' });
  assert.deepEqual(withPic.map((b) => b.type), ['text', 'text', 'image', 'text'], 'the picture after the cached parts');
  assert.equal(withPic[2].cache_control, undefined);
  assert.equal(inputTokens({ input_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 6000 }), 6120);
  assert.equal(inputTokens({ input_tokens: 50 }), 50);
});
