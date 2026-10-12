// Example statement: August–October 2026, with a trip to Romania (3–8 Oct).
let n = 0;
const t = (date, description, amount, currency = 'ILS', original = null) => ({ id: 's' + (++n), date, description, amount, currency, original });
export const SAMPLE = [
  t('2026-08-04', 'שופרסל דיל רמת גן', 412), t('2026-08-07', 'ארומה תל אביב', 46), t('2026-08-11', 'סונול רמת גן', 280),
  t('2026-08-20', 'WIZZ AIR HU WIZZAIR.COM', 1380), t('2026-08-24', 'נטפליקס', 55), t('2026-08-28', 'רמי לוי', 356),
  t('2026-09-02', 'BOOKING.COM HOTEL BUCHAREST', 2140), t('2026-09-05', 'שופרסל דיל רמת גן', 389), t('2026-09-09', 'חברת החשמל', 410),
  t('2026-09-15', 'AIRBNB * HM8Q2X', 1160), t('2026-09-18', 'ארומה תל אביב', 52), t('2026-09-22', 'פז יילו גבעתיים', 255),
  t('2026-09-28', 'הפניקס ביטוח נסיעות', 186), t('2026-10-01', 'שופרסל דיל רמת גן', 298),
  t('2026-10-03', 'JAMES RICHARDSON DUTY FREE נתב"ג', 420),
  t('2026-10-03', 'UBER *TRIP BUCHAREST RO', 38, 'RON', 46), t('2026-10-03', "CARU' CU BERE BUCURESTI RO", 254, 'RON', 312),
  t('2026-10-04', 'MEGA IMAGE BUCURESTI RO', 104, 'RON', 128), t('2026-10-04', 'MUZEUL NATIONAL DE ARTA BUCURESTI', 65, 'RON', 80),
  t('2026-10-04', 'BOLT.EU BUCURESTI RO', 31, 'RON', 38), t('2026-10-05', 'AUTONOM RENT A CAR OTOPENI RO', 562, 'RON', 690),
  t('2026-10-05', 'OMV PETROM SINAIA RO', 212, 'RON', 260), t('2026-10-05', 'CASTELUL PELES SINAIA', 114, 'RON', 140),
  t('2026-10-06', 'RESTAURANT SERGIANA BRASOV RO', 233, 'RON', 286), t('2026-10-06', 'KAUFLAND BRASOV RO', 174, 'RON', 214),
  t('2026-10-07', 'CETATEA RASNOV RO', 49, 'RON', 60), t('2026-10-07', 'ZARA AFI BRASOV RO', 440, 'RON', 540),
  t('2026-10-07', 'STARBUCKS BRASOV RO', 39, 'RON', 48), t('2026-10-08', 'HEINEMANN DUTY FREE OTOPENI RO', 155, 'RON', 190),
  t('2026-10-08', 'עמלת המרה מט"ח', 38),
  t('2026-10-09', 'שופרסל דיל רמת גן', 344), t('2026-10-10', 'ארומה תל אביב', 49)
];
