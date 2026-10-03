// Exchange rates for a date: the Bank of Israel representative rate ("שער
// יציג") of that day, or the last one before it (weekends and holidays have
// none). Parsing is kept apart so it can be tested without the network.

const SUPPORTED = ['USD', 'EUR', 'GBP'];

// BOI SDMX, CSV: a header row naming TIME_PERIOD and OBS_VALUE.
function boiUrl(currency, date) {
  const d = new Date(date + 'T12:00:00Z');
  const from = new Date(d.getTime() - 10 * 864e5).toISOString().slice(0, 10);
  return `https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_${currency}_ILS?startperiod=${from}&endperiod=${date}&format=csv`;
}

// The last observation on or before the date: { rate, date } or null.
function parseBoiCsv(csv, date) {
  const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const head = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const t = head.indexOf('TIME_PERIOD');
  const v = head.indexOf('OBS_VALUE');
  if (t < 0 || v < 0) return null;
  let best = null;
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const day = cells[t];
    const rate = Number(cells[v]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(rate > 0) || day > date) continue;
    if (!best || day > best.date) best = { rate, date: day };
  }
  return best;
}

// Frankfurter (ECB) answers with the last business day on or before the date.
function frankfurterUrl(currency, date) {
  return `https://api.frankfurter.app/${date}?from=${currency}&to=ILS`;
}
function parseFrankfurter(json) {
  const rate = Number(json && json.rates && json.rates.ILS);
  return rate > 0 && /^\d{4}-\d{2}-\d{2}$/.test(json.date || '') ? { rate, date: json.date } : null;
}

function validRequest(currency, date, today) {
  return SUPPORTED.includes(currency) && /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date >= '2000-01-01' && date <= today;
}

module.exports = { SUPPORTED, boiUrl, parseBoiCsv, frankfurterUrl, parseFrankfurter, validRequest };
