const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PaymentSlip } = require('../src/models');
const paymentSlipService = require('../src/services/paymentSlip.service');
const { canConfirmPayment } = require('../src/utils/paymentConfirmationAccess');

const originals = { findAll: PaymentSlip.findAll };
test.afterEach(() => { PaymentSlip.findAll = originals.findAll; });

// --- Task 7: the registration-flow slip endpoints reuse the EXISTING
// payment-confirmation permission (canConfirmPayment / fees.confirm_payment /
// accounting.confirm_income / admin,accountant,manager), not a new one, and
// are gated separately from the pre-existing payment-slips.view/.approve
// permissions that already govern the standalone Payment Verification page.

test('a plain Agent (no payment-confirmation role or permission) cannot confirm payment and, by the same rule, cannot use the registration slip endpoints', () => {
  const agent = { isSystemAdmin: false, roles: [{ name: 'agent' }], permissions: ['student.convert', 'payment-slips.view'] };
  assert.equal(canConfirmPayment(agent), false, 'having only payment-slips.view must NOT be enough for the registration-flow slip preview');
});

test('an accountant (role-based, no explicit permission codes) can confirm payment / use the registration slip endpoints', () => {
  const accountant = { isSystemAdmin: false, roles: [{ name: 'Accountant' }], permissions: [] };
  assert.equal(canConfirmPayment(accountant), true);
});

test('a user with the explicit fees.confirm_payment permission (no special role) can confirm payment / use the registration slip endpoints', () => {
  const user = { isSystemAdmin: false, roles: [{ name: 'staff' }], permissions: ['fees.confirm_payment'] };
  assert.equal(canConfirmPayment(user), true);
});

test('a system admin can always confirm payment / use the registration slip endpoints', () => {
  assert.equal(canConfirmPayment({ isSystemAdmin: true, roles: [], permissions: [] }), true);
});

test('education.routes.js gates both new registration-payment-slip endpoints with canConfirmPayment (the SAME middleware already used for /fees/installments/:id/confirm), placed before the /students/:id wildcard so it cannot be shadowed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/education.routes.js'), 'utf8');
  const resolveLine = source.split('\n').find((line) => line.includes("get('/students/registration-payment-slip'"));
  const fileLine = source.split('\n').find((line) => line.includes("get('/students/registration-payment-slip/:slipId/file'"));
  assert.ok(resolveLine && /canConfirmPayment/.test(resolveLine));
  assert.ok(fileLine && /canConfirmPayment/.test(fileLine));
  const resolveIndex = source.indexOf("'/students/registration-payment-slip'");
  const wildcardIndex = source.indexOf("get('/students/:id',");
  assert.ok(resolveIndex > -1 && wildcardIndex > -1 && resolveIndex < wildcardIndex, 'the literal route must be registered before the /students/:id wildcard or Express will never reach it');
});

test('the existing /api/payment-slips/:id/file route (payment-slips.view) is untouched — the two permission boundaries stay independent', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/paymentSlip.routes.js'), 'utf8');
  assert.match(source, /get\('\/:id\/file', permit\('payment-slips\.view'\)/);
});

// --- Task 6: latest-slip resolution ------------------------------------------

test('resolveRegistrationContextSlips resolves by conversationId/leadId/contactId (any match), newest first, and points previewUrl at the NEW canConfirmPayment-gated endpoint, not the old payment-slips.view one', async () => {
  let capturedWhere = null;
  PaymentSlip.findAll = async ({ where }) => {
    capturedWhere = where;
    return [
      { id: 5, toJSON: () => ({ id: 5, destinationBankAccount: null }) },
      { id: 3, toJSON: () => ({ id: 3, destinationBankAccount: null }) }
    ];
  };

  const result = await paymentSlipService.resolveRegistrationContextSlips({ conversationId: 10, leadId: 20, contactId: 30 });

  assert.equal(result.latest.id, 5);
  assert.equal(result.slips.length, 2);
  assert.equal(result.latest.previewUrl, '/api/education/students/registration-payment-slip/5/file');
  assert.doesNotMatch(result.latest.previewUrl, /\/api\/payment-slips\//);
  assert.ok(capturedWhere, 'the query must filter by the given context identifiers');
});

test('resolveRegistrationContextSlips returns no error and an empty result when no slip exists for the conversation', async () => {
  PaymentSlip.findAll = async () => [];
  const result = await paymentSlipService.resolveRegistrationContextSlips({ conversationId: 999 });
  assert.equal(result.latest, null);
  assert.deepEqual(result.slips, []);
});

test('resolveRegistrationContextSlips returns an empty result (no query at all) when no context identifiers are given', async () => {
  let called = false;
  PaymentSlip.findAll = async () => { called = true; return []; };
  const result = await paymentSlipService.resolveRegistrationContextSlips({});
  assert.equal(called, false);
  assert.equal(result.latest, null);
});
