// The Shabbat testing rounds: 15 made-up households across the country, each
// with its own list, screen and habits. Names, places and lists are
// invented; everything runs against the fake in-memory Supabase.
import { makeFakeDb, mockSupabase, signIn, collectErrors } from './helpers.mjs';

const OWNER = 'budgetapp2852@gmail.com';
const TODAY = new Date(2026, 10, 27, 10);
export const HOUSEHOLDS = [
  { name: 'כהן', city: 'תל אביב', code: '5000', width: 1440, people: 2, line: 'חלב 3%, לחם מלא, קפה טורקי, אבוקדו, יין לקידוש ונרות שבת' },
  { name: 'לוי', city: 'בני ברק', code: '6100', width: 390, people: 9, line: 'קמח רגיל, 3 שמן קנולה, חלות, 2 ק"ג עגבניות, חיתולים מידה 4, מגבונים x3, פרגיות, תה ויסוצקי' },
  { name: 'מזרחי', city: 'באר שבע', code: '9000', width: 360, people: 5, line: 'פיתות, חומוס, טחינה גולמית, כנפיים, קבב, ספרייט, ביסקוויטים' },
  { name: 'חדאד', city: 'נצרת', code: '7300', width: 1280, people: 6, line: 'זעתר, לבנה, זיתים ירוקים, שמן זית, פיתות, מלפפונים, חלבה' },
  { name: 'פרץ', city: 'אילת', code: '2600', width: 320, people: 1, line: 'מים מינרליים 6 בקבוקים, קולה זירו, פיצה קפואה, במבה' },
  { name: 'פרידמן', city: 'ירושלים', code: '3000', width: 1280, people: 7, line: 'יין לקידוש, מיץ ענבים, חלות, דגים, רסק עגבניות, בצק עלים, גפרורים' },
  { name: 'בן דוד', city: 'קריית שמונה', code: '2800', width: 768, people: 2, line: 'שיבולת שועל, תה ירוק, דבש, לחמניות המבורגר, קוטג\'' },
  { name: 'גולן', city: 'כפר בלום', code: '0154', width: 1024, people: 4, line: 'ברוקולי, כרובית, שעועית ירוקה, טופו, קינואה, משקה שקדים' },
  { name: 'שפירא', city: 'חיפה', code: '4000', width: 1366, people: 3, line: 'פסטה פנה, רוטב עגבניות, גבינה פרמזן, יין אדום, שוקולד מריר' },
  { name: 'אזולאי', city: 'אשדוד', code: '70', width: 414, people: 6, line: 'עוף שלם, שוקיים עוף, אורז בסמטי, 2 שקיות חלב, שקיות זבל, אקונומיקה' },
  { name: 'כץ', city: 'מודיעין', code: '1200', width: 1280, people: 4, line: 'דייסת אורז, מטרנה שלב 2, בננות, יוגורט, חמאת בוטנים' },
  { name: 'יוסף', city: 'אריאל', code: '3570', width: 412, people: 5, line: 'קילו עגבניות, בצל, תפוחי אדמה, שניצל, ביצים L 12, קורנפלקס' },
  { name: 'ביטון', city: 'דימונה', code: '2200', width: 375, people: 4, line: 'לחם, חלב, ביצים, אורז, שמן, סוכר' },
  { name: 'רוזן', city: 'הרצליה', code: '6400', width: 1920, people: 2, line: 'סלמון, אנטריקוט, בירה, ויסקי, קרקרים, גבינה צהובה 28%' },
  { name: 'נחום', city: 'צפת', code: '8000', width: 360, people: 8, line: 'קמח, סוכר, שמרים, אבקת אפייה, וניל, מרגרינה, פתיליות' }
];

export async function openHousehold(browser, server, h, setup = () => {}) {
  const page = await browser.newPage({ viewport: { width: h.width, height: 860 } });
  await page.clock.setFixedTime(TODAY);
  const db = makeFakeDb(TODAY);
  db.tables.shopping_items = [];
  db.tables.households = [{ id: db.hid, shop_area: null }];
  db.tables.household_area = [{ household_id: db.hid, city_code: h.code, city: h.city, hood: null }];
  db.tables.household_stores = [];
  db.tables.memberships[0].display_name = 'משפחת ' + h.name;
  setup(db);
  const errors = collectErrors(page);
  await mockSupabase(page, db);
  await signIn(page, server.base);
  await page.evaluate((e) => { const k = 'sb-bwwupwbakefjhwropdin-auth-token'; const x = JSON.parse(localStorage.getItem(k)); x.user.email = e; localStorage.setItem(k, JSON.stringify(x)); }, OWNER);
  await page.goto(server.base + '/app/#/shop');
  await page.reload();
  await page.waitForSelector('.shop-add, .sl-chat');
  if (!(await page.locator('.shop-add').count())) await page.locator('.sl-chat').first().click();
  await page.waitForSelector('.shop-add');
  return { page, db, errors };
}
