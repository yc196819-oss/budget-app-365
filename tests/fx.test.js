const { test } = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../server/fx');

test('Bank of Israel CSV: the rate of the day, or the last one before it', () => {
  const csv = 'SERIES_CODE,FREQ,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS\nRER_USD_ILS,D,2026-09-10,3.701,F\nRER_USD_ILS,D,2026-09-11,3.688,F\nRER_USD_ILS,D,2026-09-14,3.712,F\n';
  assert.deepEqual(fx.parseBoiCsv(csv, '2026-09-11'), { rate: 3.688, date: '2026-09-11' });
  assert.deepEqual(fx.parseBoiCsv(csv, '2026-09-13'), { rate: 3.688, date: '2026-09-11' }, 'weekend → Friday');
  assert.deepEqual(fx.parseBoiCsv(csv, '2026-09-20'), { rate: 3.712, date: '2026-09-14' });
  assert.equal(fx.parseBoiCsv(csv, '2026-09-01'), null);
  assert.equal(fx.parseBoiCsv('', '2026-09-11'), null);
  assert.equal(fx.parseBoiCsv('A,B\n1,2', '2026-09-11'), null);
  assert.deepEqual(fx.parseBoiCsv('"TIME_PERIOD","OBS_VALUE"\n"2026-09-11","3.688"', '2026-09-11'), { rate: 3.688, date: '2026-09-11' });
});

test('the request asks for ten days back to cover weekends and holidays', () => {
  const u = fx.boiUrl('USD', '2026-09-13');
  assert.match(u, /RER_USD_ILS\?startperiod=2026-09-03&endperiod=2026-09-13&format=csv$/);
  assert.equal(fx.frankfurterUrl('EUR', '2026-09-13'), 'https://api.frankfurter.app/2026-09-13?from=EUR&to=ILS');
  assert.deepEqual(fx.parseFrankfurter({ date: '2026-09-11', rates: { ILS: 4.05 } }), { rate: 4.05, date: '2026-09-11' });
  assert.equal(fx.parseFrankfurter({ rates: {} }), null);
});

test('only known currencies and real past dates', () => {
  assert.equal(fx.validRequest('USD', '2026-09-13', '2026-10-03'), true);
  assert.equal(fx.validRequest('JPY', '2026-09-13', '2026-10-03'), false);
  assert.equal(fx.validRequest('USD', '2026-10-04', '2026-10-03'), false, 'no future rates');
  assert.equal(fx.validRequest('USD', '13/09/2026', '2026-10-03'), false);
});
