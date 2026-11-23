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

// A blog page (made up) shaped like many Hebrew food blogs: long menus, an
// intro and a video, then the ingredients as plain lists, with no structured
// recipe. Its text is what is sent, from the ingredients heading on.
const fs = require('node:fs');
const path = require('node:path');
const { readRecipe, parseAnswer, answerText } = require('../server/recipe');
const { webFetchTool, claudeRequest } = require('../server/claude');
const blog = fs.readFileSync(path.join(__dirname, 'fixtures/recipe-blog-page.html'), 'utf8');
const LINK = 'https://recipes.example.com/meatballs';

test('a blog page without a structured recipe: menus are dropped and the ingredients are kept', () => {
  const r = recipeText(blog);
  assert.equal(r.structured, false);
  assert.equal(r.found, true);
  assert.equal(r.text.includes('קטגוריה לדוגמה'), false, 'menus are not sent');
  assert.equal(r.text.includes('פוסט קשור'), false, 'sidebar is not sent');
  for (const w of ['רכיבים', '½ קילו בשר טחון', '1 קופסה רסק עגבניות', '¼ כוס שמן', 'מתאים לכ-6 סועדים']) assert.ok(r.text.includes(w), w);
  assert.match(r.text, /בשר טחון\n1 בצל/, 'each ingredient on its own line');
});

test('even with a very long intro, the ingredients are inside what is sent', () => {
  const long = blog.replace('<p>הקדמה קצרה', '<p>' + 'סיפור ארוך על המטבח. '.repeat(800) + '</p><p>הקדמה קצרה');
  const r = recipeText(long);
  assert.ok(r.text.length <= 9000);
  assert.ok(r.text.includes('½ קילו בשר טחון'));
  assert.ok(r.text.includes('1 קופסה רסק עגבניות'));
});

test('a structured recipe nested deep, or in microdata, is found', () => {
  const nested = '<script type="application/ld+json"><!--' + JSON.stringify({ '@type': 'WebPage', mainEntity: { '@type': ['Recipe', 'Thing'], name: 'עוגה &amp; קרם', recipeIngredient: ['2 ביצים', '1 כוס סוכר'] } }) + '--></script>';
  const a = recipeText(nested);
  assert.equal(a.structured, true);
  assert.equal(a.title, 'עוגה & קרם');
  assert.match(a.text, /2 ביצים\n1 כוס סוכר/);
  const micro = recipeText('<ul><li itemprop="recipeIngredient">3 תפוחי אדמה</li><li itemprop="recipeIngredient">1 בצל</li></ul>');
  assert.equal(micro.structured, true);
  assert.match(micro.text, /3 תפוחי אדמה\n1 בצל/);
});

const answer = (items) => JSON.stringify({ title: 'קציצות', servings: 6, items });
const meat = [{ name: 'בשר טחון', qty: 0.5, unit: 'ק"ג', aisle: 'meat', pantry: false }];

test('a page that opens: read from its text, Claude does not fetch', async () => {
  const calls = [];
  const out = await readRecipe({ url: LINK }, { fetch: async () => blog, ask: async (a) => { calls.push(a); return answer(meat); } });
  assert.equal(out.via, 'page');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].readUrl, undefined);
  assert.match(calls[0].prompt, /בשר טחון/);
  assert.equal(out.recipe.servings, 6);
  assert.equal(out.recipe.items[0].name, 'בשר טחון');
});

test('a page that does not open here: Claude reads the link itself, only that site', async () => {
  const calls = [];
  const out = await readRecipe({ url: LINK }, { fetch: async () => { throw new Error('HTTP 403'); }, ask: async (a) => { calls.push(a); return 'קראתי את הדף. ' + answer(meat); } });
  assert.equal(out.via, 'claude');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].readUrl.hostname, 'recipes.example.com');
  assert.ok(calls[0].prompt.includes('web_fetch'));
  assert.ok(calls[0].prompt.includes(LINK));
  assert.equal(out.recipe.items.length, 1);
});

test('a page that opens but yields nothing: Claude reads the link as a second try', async () => {
  const calls = [];
  const out = await readRecipe({ url: LINK }, { fetch: async () => '<p>טוען...</p>', ask: async (a) => { calls.push(a); return calls.length === 1 ? answer([]) : answer(meat); } });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].readUrl);
  assert.equal(out.via, 'claude');
});

test('when neither way finds ingredients, a clear message; a bad link is refused before anything', async () => {
  const none = await readRecipe({ url: LINK }, { fetch: async () => { throw new Error('timeout'); }, ask: async () => { throw new Error('Claude 500'); } });
  assert.equal(none.status, 502);
  assert.match(none.error, /לא הצלחנו לפתוח את הקישור/);
  const empty = await readRecipe({ url: LINK }, { fetch: async () => blog, ask: async () => answer([]) });
  assert.equal(empty.status, 422);
  let asked = false;
  const bad = await readRecipe({ url: 'http://127.0.0.1/admin' }, { fetch: async () => blog, ask: async () => { asked = true; return ''; } });
  assert.equal(bad.status, 400);
  assert.equal(asked, false);
  const text = await readRecipe({ text: '2 ביצים, חצי קילו בשר טחון' }, { ask: async (a) => { assert.equal(a.readUrl, undefined); return answer(meat); } });
  assert.equal(text.recipe.items.length, 1);
});

test('Claude\'s answer is the JSON after its last tool result; the fetch tool is limited to one site', () => {
  assert.equal(parseAnswer('no json'), null);
  assert.equal(parseAnswer('{bad'), null);
  const content = [{ type: 'text', text: 'אקרא את הדף {לא זה}' }, { type: 'server_tool_use', name: 'web_fetch' }, { type: 'web_fetch_tool_result' }, { type: 'text', text: answer(meat) }];
  assert.equal(parseAnswer(answerText(content)).items[0].name, 'בשר טחון');
  const t = webFetchTool('claude-sonnet-5', 'recipes.example.com');
  assert.equal(t.type, 'web_fetch_20260209');
  assert.deepEqual(t.allowed_domains, ['recipes.example.com']);
  assert.equal(webFetchTool('claude-haiku-4-5', 'a.example.com').type, 'web_fetch_20250910');
  const body = JSON.parse(claudeRequest({ key: 'k', model: 'claude-sonnet-5', maxTokens: 10, messages: [{ role: 'user', content: 'x' }], tools: [t] }).init.body);
  assert.equal(body.tools[0].name, 'web_fetch');
  assert.equal('tools' in JSON.parse(claudeRequest({ key: 'k', model: 'm', maxTokens: 10, content: 'x' }).init.body), false);
});
