const { test } = require('node:test');
const assert = require('node:assert/strict');
const { feeds, parseRss, recentItems, newsPrompt, pickDigest } = require('../server/news');

const RSS = `<?xml version="1.0"?><rss><channel><title>x</title>
<item><title><![CDATA[בנק ישראל הותיר את הריבית ב-3.25%]]></title><link>https://www.globes.co.il/a1</link><description><![CDATA[<p>הוועדה המוניטרית &amp; ההחלטה הבאה</p>]]></description><pubDate>Tue, 13 Oct 2026 07:00:00 +0300</pubDate></item>
<item><title>הדולר ירד ל-3.078 שקלים</title><link>https://www.globes.co.il/a2</link><pubDate>Tue, 13 Oct 2026 06:00:00 +0300</pubDate></item>
<item><title>ישן</title><link>https://www.globes.co.il/old</link><pubDate>Mon, 05 Oct 2026 06:00:00 +0300</pubDate></item>
<item><title>בלי קישור</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

test('RSS: titles, links and text cleaned; only web links', () => {
  const items = parseRss(RSS, 'גלובס');
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'בנק ישראל הותיר את הריבית ב-3.25%');
  assert.equal(items[0].desc, 'הוועדה המוניטרית & ההחלטה הבאה');
  assert.equal(items[0].source, 'גלובס');
  assert.ok(!items.some((x) => x.link.startsWith('javascript')));
});

test('recent items: the last day and a half, newest first, no repeats', () => {
  const a = parseRss(RSS, 'גלובס');
  const list = recentItems([a, [{ ...a[0], source: 'כלכליסט' }]], new Date('2026-10-13T09:00:00+03:00'));
  assert.deepEqual(list.map((x) => x.link), ['https://www.globes.co.il/a1', 'https://www.globes.co.il/a2']);
});

test('feeds can be replaced from the environment, https only', () => {
  assert.ok(feeds(undefined).length >= 3);
  assert.deepEqual(feeds('בנק ישראל|https://boi.example/rss,רע|http://x'), [['בנק ישראל', 'https://boi.example/rss']]);
});

test('the prompt numbers the headlines and forbids product advice', () => {
  const p = newsPrompt(parseRss(RSS, 'גלובס'), '2026-10-13');
  assert.match(p, /\[0\] \(גלובס\) בנק ישראל הותיר/);
  assert.match(p, /אל תמליץ לקנות או למכור נייר ערך/);
  assert.match(p, /אל תמציא מספרים/);
});

test('the digest: links from the feeds only, a pulse number must be in a headline, at least 3 items', () => {
  const items = [...parseRss(RSS, 'גלובס'), { source: 'ynet', title: 'מחירי המזון עלו', link: 'https://ynet.example/c', desc: '', date: null }];
  const raw = { items: [
    { title: 'הריבית נשארה 3.25%', summary: 'בנק ישראל לא שינה.', families: 'הפריים לא זז.', topic: 'rate', source: 0, question: 'מה עם המשכנתא?', answer: 'ההחזר לא משתנה החודש.', link: 'https://evil.example' },
    { title: 'הדולר ירד', summary: 'השקל התחזק.', families: 'חופשות זולות.', topic: 'currency', source: 1 },
    { title: 'כפול', summary: 'x', topic: 'rate', source: 0 },
    { title: 'מזון', summary: 'עלה.', families: 'סל יקר יותר.', topic: 'weird', source: 3 },
    { title: 'לא קיים', summary: 'x', source: 99 }
  ], pulse: [{ label: 'ריבית', value: '3.25%' }, { label: 'מדד', value: '9.9%' }], term: { name: 'פריים', explain: 'ריבית בנק ישראל + 1.5%.', quiz: { q: 'מה הפריים?', options: ['3.25%', '4.75%', '5%'], correct: 1 } } };
  const d = pickDigest(raw, items, '2026-10-13');
  assert.equal(d.items.length, 3);
  assert.equal(d.items[0].source.link, 'https://www.globes.co.il/a1', 'the link is the feed\'s');
  assert.equal(d.items[2].topic, 'other');
  assert.deepEqual(d.pulse.map((p) => p.value), ['3.25%'], 'an invented number is dropped');
  assert.equal(d.term.quiz.correct, 1);
  assert.equal(pickDigest({ items: raw.items.slice(0, 2) }, items, '2026-10-13'), null, 'fewer than 3: no digest');
  assert.equal(pickDigest(null, items, 'x'), null);
});
