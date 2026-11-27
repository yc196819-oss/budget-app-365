// Kashrut from Open Food Facts (an open product database, free to use), for
// the most common products in our catalog: asked once for each product, and
// what it says is kept on the product for good. The nightly price load never
// writes kosher_cert, so a certifier found here stays. Started by the owner,
// a small batch at a time, with a report of what was found.

const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = 'image_front_small_url,labels,labels_tags';
// Open Food Facts asks for at most 100 product reads a minute.
const GAP_MS = 700;

// What one Open Food Facts answer says: the certifier its labels name (one
// of ours, or null), whether it says kosher at all, and its photo.
function readLabels(json, certFromText) {
  const p = (json && json.product) || null;
  if (!p) return { found: false, cert: null, kosher: false, image: '' };
  const tags = Array.isArray(p.labels_tags) ? p.labels_tags : [];
  // Tags are written "he:בד-ץ-בית-יוסף" or "en:badatz-beit-yosef".
  const text = [String(p.labels || ''), ...tags.map((t) => String(t).replace(/^[a-z]{2}:/, '').replace(/[-_]+/g, ' '))].join(' ').slice(0, 2000);
  const cert = (certFromText && certFromText(text)) || null;
  const kosher = !!cert || /kosher|כשר|casher|koscher/i.test(text);
  const url = String(p.image_front_small_url || '');
  return { found: true, cert, kosher, image: /^https:\/\/images\.openfoodfacts\.org\//.test(url) ? url : '' };
}

const empty = () => ({ running: false, asked: 0, found: 0, certs: {}, kosherNoCert: 0, missing: 0, failed: 0, started_at: null, done_at: null, error: null });

// One batch: the `limit` most common products whose kashrut is unknown and
// that were not asked yet (food only), each asked once.
//   db.todo(n): [{ barcode, name }], most common first
//   db.save(barcode, { image_url?, kosher_cert?, image_checked_at })
//   isFree(product): no kashrut to check (non-food, fresh produce)
async function runBatch({ db, fetchFn, certFromText, isFree = () => false, limit = 200, gapMs = GAP_MS, state = empty(), now = () => new Date() }) {
  Object.assign(state, empty(), { running: true, started_at: now().toISOString() });
  try {
    const list = (await db.todo(limit * 3)).filter((p) => p && /^[0-9]{8,14}$/.test(String(p.barcode)) && !isFree(p)).slice(0, limit);
    for (const p of list) {
      let r = null;
      try {
        const res = await fetchFn(OFF_URL + p.barcode + '.json?fields=' + FIELDS, { headers: { 'user-agent': 'BudgetApp/1.0 (household budget app, Israel)' }, signal: AbortSignal.timeout(8000) });
        if (res.status === 404) r = { found: false };
        else if (!res.ok) throw new Error('HTTP ' + res.status);
        else r = readLabels(await res.json(), certFromText);
      } catch (_e) {
        state.failed++;
      }
      if (r) {
        state.asked++;
        if (!r.found) state.missing++;
        else {
          state.found++;
          if (r.cert) state.certs[r.cert] = (state.certs[r.cert] || 0) + 1;
          else if (r.kosher) state.kosherNoCert++;
        }
        await db.save(p.barcode, { image_checked_at: now().toISOString(), ...(r.image ? { image_url: r.image } : {}), ...(r.cert ? { kosher_cert: r.cert } : {}) });
      }
      if (gapMs) await new Promise((ok) => setTimeout(ok, gapMs));
    }
  } catch (err) {
    state.error = String(err.message || err).slice(0, 200);
  }
  state.running = false;
  state.done_at = now().toISOString();
  return state;
}

module.exports = { readLabels, runBatch, empty, OFF_URL };
