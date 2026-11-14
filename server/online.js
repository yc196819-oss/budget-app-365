// Shopping online and in the shop are two prices: a chain that sells online
// publishes its online warehouse as one more "branch" ("מרלוג אינטרנט",
// "שופרסל ONLINE"). It is compared as a chain of its own ("רמי לוי אונליין"),
// and never taken as the chain's shop branch (general or near a family).

// A branch that is the chain's online shop, by its name. ("משלוחים" alone is
// a kiosk that delivers, not an online shop.)
const ONLINE = /אונליין|און\s*ליין|online|אינטרנט|וולט|wolt/i;
const isOnline = (name) => ONLINE.test(String(name || ''));

// The online chain's key and name, from the chain's.
const SUFFIX = '-online';
const onlineKey = (key) => key + SUFFIX;
const onlineName = (name) => name + ' אונליין';
const baseKey = (key) => String(key || '').replace(/-online$/, '');

// Each chain's online branches (lowest number first): { chain: [store_id] }.
function onlineStores(stores) {
  const out = {};
  for (const s of stores || []) if (isOnline(s.name)) (out[s.chain] = out[s.chain] || []).push(String(s.store_id));
  for (const k of Object.keys(out)) out[k].sort((a, b) => Number(a) - Number(b));
  return out;
}

// A chain's rows as its online chain's.
const asOnline = (rows, chain) => rows.map((r) => ({ ...r, chainKey: onlineKey(chain.key), chainName: onlineName(chain.name) }));

module.exports = { isOnline, onlineKey, onlineName, baseKey, onlineStores, asOnline, SUFFIX };
