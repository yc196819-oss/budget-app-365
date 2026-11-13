// Deals at the supermarket (the price transparency law's "PromoFull" file):
// every chain publishes its branch's deals, with who gets them (everyone, or
// a club or a credit card), whether a coupon is needed, a minimum purchase,
// how many must be bought ("2 ב-15"), until when, and the products. Read
// here into one row per product and deal. Pure.

const tag = (s, t) => { const m = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>', 'i').exec(s); return m ? m[1].trim() : ''; };
const unescape = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const num = (s) => { const n = Number(String(s || '').trim()); return Number.isFinite(n) ? n : null; };
const when = (s) => { const v = String(s || '').trim(); if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null; const d = new Date(v.slice(0, 19) + '+02:00'); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

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
    const items = [];
    const ri = /<PromotionItem>([\s\S]*?)<\/PromotionItem>/gi;
    let x;
    while ((x = ri.exec(p))) {
      const it = x[1];
      const barcode = tag(it, 'ItemCode').replace(/\D/g, '');
      if (!/^[0-9]{8,14}$/.test(barcode)) continue;
      items.push({
        barcode,
        minQty: num(tag(it, 'MinQty')) || num(tag(p, 'MinQty')) || 1,
        maxQty: num(tag(it, 'MaxQty')) || num(tag(p, 'MaxQty')) || null,
        price: num(tag(it, 'DiscountedPrice')) ?? num(tag(p, 'DiscountedPrice')),
        rate: num(tag(it, 'DiscountRate')) ?? num(tag(p, 'DiscountRate')),
        weighted: tag(it, 'bIsWeighted') === '1' || tag(p, 'IsWeightedPromo') === '1'
      });
    }
    if (!items.length) continue;
    out.push({
      id: tag(p, 'PromotionID').slice(0, 30),
      text: unescape(tag(p, 'PromotionDescription')).replace(/\s+/g, ' ').slice(0, 120),
      // Everyone: no club and no credit card ("0", or nothing written).
      // ("0 - כלל הלקוחות" at Shufersal; a club is "2 - מועדון אשראי…").
      everyone: club === '' || /^0(\s|-|$)/.test(club),
      coupon: tag(p, 'AdditionalIsCoupon') === '1',
      minBuy: num(tag(p, 'MinPurchaseAmount')) || 0,
      starts: when(tag(p, 'PromotionStartDateTime') || tag(p, 'PromotionStartDate')),
      ends: when(tag(p, 'PromotionEndDateTime') || tag(p, 'PromotionEndDate')),
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
    if (p.gift || (p.ends && new Date(p.ends).getTime() < today)) continue;
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

module.exports = { parsePromoFile, promoRows };
