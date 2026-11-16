// Reading a recipe from a link: only public pages, the structured recipe
// when the site has one, otherwise the page's text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { privateIp, checkUrl, fetchPage, recipeText, RECIPE_PROMPT } = require('../server/recipe');

test('private and local addresses are never fetched', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(privateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) assert.equal(privateIp(ip), false, ip);
});

test('only plain web links are taken', () => {
  assert.ok(checkUrl('https://recipes.example.co.il/shakshuka'));
  for (const bad of ['file:///etc/passwd', 'ftp://x.com/a', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'https://a.com:8080/', 'https://user:pw@a.com/', 'not a link', '']) assert.equal(checkUrl(bad), null, bad);
});

test('a page whose name points inside is refused, and so is a redirect there', async () => {
  const pub = async () => [{ address: '93.184.216.34' }];
  await assert.rejects(fetchPage('https://inside.example.com/', async () => { throw new Error('should not fetch'); }, async () => [{ address: '10.0.0.7' }]), /blocked/);
  let calls = 0;
  const fetchFn = async (u) => { calls++; return calls === 1 ? new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } }) : new Response('secret'); };
  await assert.rejects(fetchPage('https://ok.example.com/', fetchFn, pub), /bad link/);
  const html = await fetchPage('https://ok.example.com/', async () => new Response('<p>שקשוקה</p>'), pub);
  assert.match(html, /שקשוקה/);
});

test('the structured recipe is used when the page has one; otherwise the text', () => {
  const page = '<html><title>שקשוקה - אתר</title><script type="application/ld+json">' + JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'Recipe', name: 'שקשוקה', recipeYield: '4 מנות', recipeIngredient: ['6 ביצים', '1 ק"ג עגבניות'] }] }) + '</script><body>הרבה טקסט</body></html>';
  const r = recipeText(page);
  assert.equal(r.structured, true);
  assert.equal(r.title, 'שקשוקה');
  assert.match(r.text, /4 מנות[\s\S]*6 ביצים[\s\S]*1 ק"ג עגבניות/);
  const plain = recipeText('<title>עוגה</title><script>var x=1</script><style>p{}</style><p>2 כוסות&nbsp;קמח</p>');
  assert.equal(plain.structured, false);
  assert.equal(plain.title, 'עוגה');
  assert.equal(plain.text.includes('var x'), false);
  assert.match(plain.text, /2 כוסות קמח/);
  assert.match(RECIPE_PROMPT, /pantry/);
});
