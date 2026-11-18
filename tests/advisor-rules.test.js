const test = require('node:test');
const assert = require('node:assert/strict');
const { OWN_NUMBERS_RULE, historyText } = require('../server/advisorRules.js');

test('the advisor calculates with the numbers the person gave, and never says it has no data when they gave it', () => {
  assert.match(OWN_NUMBERS_RULE, /חשב עם המספרים שלו/);
  assert.match(OWN_NUMBERS_RULE, /לפי מה שכתבת:/);
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
