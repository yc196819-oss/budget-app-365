// Morning news: headlines from public RSS feeds (free, no tokens), then one AI
// pass a day for everyone that picks what matters to a family and explains it
// in its own words, with the link to the source. Pure, except fetchFeeds.

// Feeds can be replaced without code: NEWS_FEEDS="name|url,name|url".
const DEFAULT_FEEDS = [
  ['גלובס', 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=585'],
  ['כלכליסט', 'https://www.calcalist.co.il/GeneralRSS/0,16335,L-8,00.xml'],
  ['ynet כלכלה', 'https://www.ynet.co.il/Integration/StoryRss6.xml'],
  ['TheMarker', 'https://www.themarker.com/srv/tm-news']
];
function feeds(env = process.env.NEWS_FEEDS) {
  if (!env) return DEFAULT_FEEDS;
  return String(env).split(',').map((x) => x.split('|').map((s) => s.trim())).filter(([n, u]) => n && /^https:\/\//.test(u || ''));
}

const TOPICS = ['rate', 'currency', 'prices', 'jobs', 'tax', 'housing', 'markets', 'energy', 'benefits', 'other'];
const clean = (s, max) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i')); return m ? m[1] : ''; };

// RSS 2.0 items -> [{ title, link, desc, date }]. Only http(s) links.
function parseRss(xml, source) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const title = clean(tag(it, 'title'), 200);
    const link = clean(tag(it, 'link'), 500);
    if (!title || !/^https?:\/\//.test(link)) continue;
    const when = new Date(clean(tag(it, 'pubDate'), 80) || clean(tag(it, 'dc:date'), 80));
    out.push({ source, title, link, desc: clean(tag(it, 'description'), 300), date: isNaN(when) ? null : when.toISOString() });
  }
  return out;
}

// The last day and a half, newest first, no repeated titles, at most 40.
function recentItems(lists, now = new Date(), max = 40) {
  const since = now.getTime() - 36 * 3600 * 1000;
  const seen = new Set();
  return lists.flat()
    .filter((x) => !x.date || new Date(x.date).getTime() >= since)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .filter((x) => { const k = x.title.replace(/\W+/g, ''); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
}

function newsPrompt(items, today) {
  const list = items.map((x, i) => `[${i}] (${x.source}) ${x.title}${x.desc ? ' — ' + x.desc : ''}`).join('\n');
  return `אתה עורך "חדשות הבוקר" באפליקציית תקציב למשפחות בישראל. היום ${today}.
לפניך כותרות מהיממה האחרונה, ממוספרות. בחר 4 עד 5 ידיעות שהכי משפיעות על הכסף של משפחה רגילה: ריבית ומשכנתאות, מחירים ואינפלציה, שער הדולר, שכר ותעסוקה, מיסים, קצבאות והטבות, דיור, אנרגיה ודלק, שוק ההון. העדף ידיעות עם מספרים ועובדות. דלג על רכילות, פוליטיקה בלי השלכה כספית וידיעות על חברה אחת.
לכל ידיעה כתוב במילים שלך (אל תעתיק משפטים מהכותרות):
- title: כותרת קצרה וברורה בעברית, עד 70 תווים.
- summary: 2 משפטים, עד 260 תווים, רק עובדות שמופיעות בכותרת או בתקציר. אל תמציא מספרים.
- families: משפט אחד, עד 200 תווים: מה זה אומר למשפחה רגילה, באופן כללי.
- topic: אחד מ: ${TOPICS.join(', ')}.
- source: המספר של הידיעה ברשימה.
- question: שאלה קצרה שמשפחה הייתה שואלת על זה, ו-answer: תשובה של 2–3 משפטים, מידע כללי בלבד.
בנוסף:
- pulse: עד 3 מספרים חשובים מהכותרות (למשל ריבית, דולר, מדד), כל אחד {label, value, note}. value בדיוק כפי שהוא מופיע בכותרת או בתקציר. אם אין, רשימה ריקה.
- term: מונח כלכלי אחד שקשור לידיעות, {name, explain (2-3 משפטים פשוטים), quiz: {q, options: [3 תשובות], correct: מספר התשובה הנכונה 0-2}}.
אינך יועץ השקעות: אל תמליץ לקנות או למכור נייר ערך, קרן או מוצר מסוים.

הכותרות:
${list}

החזר JSON בלבד:
{"items":[{"title":"","summary":"","families":"","topic":"","source":0,"question":"","answer":""}],"pulse":[{"label":"","value":"","note":""}],"term":{"name":"","explain":"","quiz":{"q":"","options":["","",""],"correct":0}}}`;
}

// The model's JSON -> a bounded digest. Links always come from the feeds,
// never from the model; a pulse number must appear in a headline.
function pickDigest(raw, items, today) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const used = new Set();
  const picked = [];
  for (const x of raw.items) {
    const i = Number(x && x.source);
    const src = Number.isInteger(i) ? items[i] : null;
    if (!src || used.has(i)) continue;
    const title = clean(x.title, 90), summary = clean(x.summary, 320);
    if (!title || !summary) continue;
    used.add(i);
    picked.push({
      title, summary,
      families: clean(x.families, 240),
      topic: TOPICS.includes(x.topic) ? x.topic : 'other',
      source: { name: src.source, link: src.link, date: src.date },
      question: clean(x.question, 120), answer: clean(x.answer, 420)
    });
    if (picked.length === 5) break;
  }
  if (picked.length < 3) return null;
  const text = items.map((x) => x.title + ' ' + x.desc).join(' ');
  const pulse = (Array.isArray(raw.pulse) ? raw.pulse : []).map((p) => ({ label: clean(p && p.label, 30), value: clean(p && p.value, 20), note: clean(p && p.note, 40) }))
    .filter((p) => p.label && p.value && /\d/.test(p.value) && text.includes(p.value.replace(/[₪$%\s]/g, '').slice(0, 12))).slice(0, 3);
  const t = raw.term && typeof raw.term === 'object' ? raw.term : null;
  const opts = t && t.quiz && Array.isArray(t.quiz.options) ? t.quiz.options.map((o) => clean(o, 80)).filter(Boolean) : [];
  const correct = t && t.quiz ? Number(t.quiz.correct) : -1;
  const term = t && clean(t.name, 40) && clean(t.explain, 400) ? {
    name: clean(t.name, 40), explain: clean(t.explain, 400),
    quiz: opts.length === 3 && correct >= 0 && correct <= 2 ? { q: clean(t.quiz.q, 140), options: opts, correct } : null
  } : null;
  return { day: today, items: picked, pulse, term };
}

async function fetchFeeds(list = feeds(), fetchImpl = fetch) {
  const results = await Promise.all(list.map(async ([name, url]) => {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (budget-app news)', Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return parseRss(await r.text(), name);
    } catch (err) {
      console.error('news feed failed:', name, err.message);
      return [];
    }
  }));
  return results;
}

module.exports = { feeds, parseRss, recentItems, newsPrompt, pickDigest, fetchFeeds, TOPICS };
