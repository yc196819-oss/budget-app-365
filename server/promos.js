// Deals at the supermarket (the price transparency law's "PromoFull" file):
// every chain publishes its branch's deals, with who gets them (everyone, or
// a club or a credit card), whether a coupon is needed, a minimum purchase,
// how many must be bought ("2 ב-15"), until when, and the products. Read
// here into one row per product and deal. Pure.

// A tag's text. (Each tag's pattern made once: a big branch's file has
// thousands of deals, and making it anew each time took half a minute.)
const TAGS = new Map();
const tag = (s, t) => {
  let re = TAGS.get(t);
  if (!re) { re = new RegExp('<' + t + '>([^<]*)</' + t + '>', 'i'); TAGS.set(t, re); }
  const m = re.exec(s);
  return m ? m[1].trim() : '';
};
const unescape = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// A number, or null when nothing is written (an empty tag is not 0).
const num = (s) => { const t = String(s == null ? '' : s).trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
// Who gets a deal that is not for everyone, from the file's words:
//   'club'  — the chain's customers club (free to join),
//   'card'  — the chain's credit card,
//   'staff' — the chain's employees, or anything else no family is (never counted).
// A deal for "the club or the credit card" is the club's (a club member gets it).
function clubKind(text) {
  const t = unescape(text);
  const alts = t.split(/[|&]/).map((x) => x.replace(/[()"=\d-]/g, ' ').trim()).filter(Boolean);
  const isStaff = (a) => /עובד|בעלים|סיטונא|טסט|עמות|לקוח גדול|רכבים/.test(a);
  const isCard = (a) => /אשראי|ישראכרט|ויזה|מאסטר|כרטיס/.test(a);
  const isClub = (a) => /מועדון|לקוחות|חבר/.test(a) && !isStaff(a) && !isCard(a);
  // Ways of paying after "&" ("ישראכרט מגנטי", "עיגול אגורות") are not who gets it.
  const who = t.split('&')[0].split('|').map((x) => x.replace(/[()"=\d-]/g, ' ').trim()).filter(Boolean);
  if ((who.length ? who : alts).some(isClub)) return 'club';
  if ((who.length ? who : alts).some(isCard)) return 'card';
  return 'staff';
}
// A time in the file is Israel's clock: +02:00 in winter, +03:00 in summer.
function israelOffset(utcGuess) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).formatToParts(utcGuess);
  const m = /GMT([+-]\d+)/.exec((parts.find((x) => x.type === 'timeZoneName') || {}).value || '');
  return m ? Number(m[1]) : 2;
}
// A date with its hour, when they come apart ("2026-11-21", "23:59:00").
function joinHour(date, hour, fallback = '00:00:00') {
  const d = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const h = String(hour || '').trim().slice(0, 8);
  return d + 'T' + (/^\d{2}:\d{2}(:\d{2})?$/.test(h) ? (h.length === 5 ? h + ':00' : h) : fallback);
}
const when = (s) => {
  const v = String(s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const local = v.slice(0, 19).length >= 19 ? v.slice(0, 19) : v.slice(0, 10) + 'T00:00:00';
  const guess = new Date(local + 'Z');
  if (Number.isNaN(guess.getTime())) return null;
  const off = israelOffset(guess);
  return new Date(guess.getTime() - off * 3600000).toISOString();
};

// The file into deals, each with its products: [{ id, text, everyone,
// coupon, minBuy, starts, ends, gift, items: [{ barcode, minQty, maxQty,
// price, rate, weighted }] }].
function parsePromoFile(xml) {
  const out = [];
  const re = /<Promotion>([\s\S]*?)<\/Promotion>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const p = m[1];
    const club = tag(p, 'ClubID') || tag(p, 'ClubId');
    // The deal's own fields, read once (a deal of a thousand products was
    // read again for each of them: half a minute for one branch's file).
    const head = p.split(/<PromotionItem>|<PromotionItems/i)[0];
    const dealMin = num(tag(head, 'MinQty'));
    const dealMax = num(tag(head, 'MaxQty'));
    const dealPrice = num(tag(head, 'DiscountedPrice'));
    const dealRate = num(tag(head, 'DiscountRate'));
    const dealWeighted = tag(head, 'IsWeightedPromo') === '1';
    const items = [];
    // (Most files write each product as <PromotionItem>; some, like Rami
    // Levy's online shop, as <Item>.)
    const ri = /<PromotionItem>([\s\S]*?)<\/PromotionItem>|<Item>([\s\S]*?)<\/Item>/gi;
    let x;
    while ((x = ri.exec(p))) {
      const it = x[1] || x[2] || '';
      const barcode = tag(it, 'ItemCode').replace(/\D/g, '');
      if (!/^[0-9]{8,14}$/.test(barcode)) continue;
      items.push({
        barcode,
        minQty: num(tag(it, 'MinQty')) || dealMin || 1,
        maxQty: num(tag(it, 'MaxQty')) || dealMax || null,
        price: num(tag(it, 'DiscountedPrice')) ?? dealPrice,
        rate: num(tag(it, 'DiscountRate')) ?? dealRate,
        weighted: tag(it, 'bIsWeighted') === '1' || dealWeighted
      });
    }
    if (!items.length) continue;
    out.push({
      id: tag(p, 'PromotionID').slice(0, 30),
      text: unescape(tag(p, 'PromotionDescription')).replace(/\s+/g, ' ').slice(0, 120),
      // Everyone: no club and no credit card ("0", or nothing written).
      // ("0 - כלל הלקוחות" at Shufersal; a club is "2 - מועדון אשראי…").
      everyone: club === '' || /^0(\s|-|$)/.test(club),
      club: club === '' || /^0(\s|-|$)/.test(club) ? null : clubKind(club),
      coupon: tag(p, 'AdditionalIsCoupon') === '1',
      minBuy: num(tag(p, 'MinPurchaseAmount')) || 0,
      // (A date and its hour may be written apart: "2026-11-21" and "23:59:00".)
      starts: when(tag(head, 'PromotionStartDateTime') || joinHour(tag(head, 'PromotionStartDate'), tag(head, 'PromotionStartHour'))),
      ends: when(tag(head, 'PromotionEndDateTime') || joinHour(tag(head, 'PromotionEndDate'), tag(head, 'PromotionEndHour'), '23:59:00')),
      gift: tag(p, 'IsGiftItem') === '1' && items.every((i) => !(i.price > 0)),
      limit: num(tag(p, 'RedemptionLimit')) || null,
      items
    });
  }
  return out;
}

// One row per product and deal, as the catalog keeps it: the price of one
// unit in the deal and how many must be bought for it. `regular`: barcode →
// the branch's regular price. The files write "2 ב-₪15" as ₪15 for the two;
// some write the number to buy as 1 and only the description and the
// discount say two, so the discount against the regular price decides.
// Left out: gifts, deals already over, and a deal price that is not below
// the regular one (or so far below it that it cannot be right).
function promoRows(promos, regular, { now = new Date() } = {}) {
  const rows = [];
  const today = now.getTime();
  for (const p of promos || []) {
    // A gift, a deal that is over, or one only the chain's employees get.
    if (p.gift || (p.ends && new Date(p.ends).getTime() < today) || p.club === 'staff') continue;
    for (const it of p.items) {
      const reg = regular.get(it.barcode);
      if (!(reg > 0) || !(it.price >= 0)) continue;
      let need = it.minQty >= 1 ? Math.round(it.minQty) : 1;
      let unit = it.weighted && it.minQty < 1 ? it.price : it.price / need;
      // The discount says the price of one: then the total is for this many.
      if (it.rate > 0 && it.rate < 100 && !(it.weighted && it.minQty < 1)) {
        const one = reg * (1 - it.rate / 100);
        const n = Math.round(it.price / one);
        if (n >= 1 && n <= 12 && Math.abs(it.price / n - one) <= Math.max(0.05, one * 0.03)) { need = Math.max(need, n); unit = it.price / need; }
      }
      if (!(unit < reg - 0.009) || unit < reg * 0.2) continue;
      rows.push({
        barcode: it.barcode,
        promo_id: p.id || 'x',
        text: p.text,
        need,
        unit_price: Math.round(unit * 100) / 100,
        // At most this many units at the deal's price (the file's limit is
        // how many times the deal is given: "2 ב-48, up to 4" is twice).
        max_qty: it.maxQty || (p.limit ? p.limit * need : null),
        everyone: p.everyone,
        club: p.club || null,
        coupon: p.coupon,
        min_buy: p.minBuy || 0,
        starts_at: p.starts,
        ends_at: p.ends
      });
    }
  }
  // One row per product and deal (a product listed twice in a deal: the cheaper).
  const seen = new Map();
  for (const r of rows) { const k = r.barcode + '|' + r.promo_id; if (!seen.has(k) || r.unit_price < seen.get(k).unit_price) seen.set(k, r); }
  return [...seen.values()];
}

module.exports = { parsePromoFile, promoRows, clubKind };
