const test = require('node:test');
const assert = require('node:assert/strict');
const { extractReferralFields, extractPricingFields } = require('../src/services/whatsapp.service');

test('extractReferralFields captures a Click-to-WhatsApp ad referral exactly as Meta sends it', () => {
  const message = {
    referral: {
      source_type: 'ad', source_id: '120099', source_url: 'https://fb.me/ad',
      headline: 'Big Sale', ctwa_clid: 'clid-abc123'
    }
  };
  assert.deepEqual(extractReferralFields(message), {
    referralSourceType: 'ad', referralSourceId: '120099', referralSourceUrl: 'https://fb.me/ad',
    referralHeadline: 'Big Sale', ctwaClid: 'clid-abc123'
  });
});

test('extractReferralFields returns nothing for an ordinary message with no referral object', () => {
  assert.deepEqual(extractReferralFields({ text: { body: 'Hi' } }), {});
  assert.deepEqual(extractReferralFields({}), {});
});

test('extractPricingFields captures the current per-message pricing (PMP) shape', () => {
  const status = { pricing: { category: 'utility', pricing_model: 'PMP', billable: true } };
  assert.deepEqual(extractPricingFields(status), {
    pricingCategory: 'utility', pricingModel: 'PMP', pricingBillable: true
  });
});

test('extractPricingFields also captures legacy conversation-based pricing (CBP) verbatim, without reinterpreting it', () => {
  const status = { pricing: { category: 'service', pricing_model: 'CBP', billable: false } };
  assert.deepEqual(extractPricingFields(status), {
    pricingCategory: 'service', pricingModel: 'CBP', pricingBillable: false
  });
});

test('extractPricingFields returns nothing (not false/unknown) when the status webhook carries no pricing object', () => {
  assert.deepEqual(extractPricingFields({ status: 'sent' }), {});
  assert.deepEqual(extractPricingFields({}), {});
});

test('extractPricingFields never guesses billable from a non-boolean value', () => {
  const status = { pricing: { category: 'marketing', pricing_model: 'PMP', billable: 'true' } };
  assert.equal(extractPricingFields(status).pricingBillable, null);
});
