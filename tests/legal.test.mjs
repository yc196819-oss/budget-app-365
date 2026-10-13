import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { TERMS_VERSION, needsConsent, consentData } from '../public/app/src/domain/legal.js';

const { ADVICE_RULE, withAdviceRule } = createRequire(import.meta.url)('../server/legal.js');

test('everyone confirms the terms once per version', () => {
  assert.equal(needsConsent({ user_metadata: {} }), true);
  assert.equal(needsConsent({}), true);
  assert.equal(needsConsent({ user_metadata: { terms_version: '2020-01' } }), true, 'a new version asks again');
  assert.equal(needsConsent({ user_metadata: { terms_version: TERMS_VERSION } }), false);
  const c = consentData(new Date('2026-10-13T10:00:00Z'));
  assert.deepEqual(c, { terms_version: TERMS_VERSION, terms_accepted_at: '2026-10-13T10:00:00.000Z' });
});

test('every advisor prompt is told it gives general information, never a specific product (investment advice law)', () => {
  const p = withAdviceRule('אתה יועץ פיננסי למשק בית. ענה קצר.');
  assert.ok(p.endsWith(ADVICE_RULE));
  assert.match(ADVICE_RULE, /אל תמליץ לקנות, למכור או להחזיק נייר ערך/);
  assert.match(ADVICE_RULE, /חוק הסדרת העיסוק בייעוץ השקעות/);
  assert.equal(withAdviceRule(p), p, 'once');
  const classify = 'סווג את השורות הבאות לקטגוריות. החזר JSON.';
  assert.equal(withAdviceRule(classify), classify, 'not for classifying lines');
  assert.match(withAdviceRule('אתה יועץ הטיולים באפליקציה'), /כללים מחייבים/);
});
