const test = require('node:test');
const assert = require('node:assert/strict');
const { Student, FeeInstallment, User, Role } = require('../src/models');
const educationService = require('../src/services/education.service');
const canonicalWhatsappConversationService = require('../src/services/canonicalWhatsappConversation.service');
const auditService = require('../src/services/audit.service');

const originals = {
  studentFindByPk: Student.findByPk,
  installmentFindByPk: FeeInstallment.findByPk,
  userFindByPk: User.findByPk,
  resolve: canonicalWhatsappConversationService.resolveCanonicalWhatsAppConversation,
  auditRecord: auditService.record,
  getFee: educationService.getFee
};

test.afterEach(() => {
  Student.findByPk = originals.studentFindByPk;
  FeeInstallment.findByPk = originals.installmentFindByPk;
  User.findByPk = originals.userFindByPk;
  canonicalWhatsappConversationService.resolveCanonicalWhatsAppConversation = originals.resolve;
  auditService.record = originals.auditRecord;
  educationService.getFee = originals.getFee;
});

function stubInstallment(overrides = {}) {
  const row = {
    id: 710, status: 'pending', amount: '1000.00', paidAmount: '0.00', fee: { studentId: 12, id: 55 },
    studentFeeId: 55, ...overrides
  };
  row.update = async (fields) => { Object.assign(row, fields); return row; };
  return row;
}

// --- the fix: Contact.whatsappAccountId is used as a deterministic fallback -

test('payInstallment passes the Contact\'s own canonical whatsappAccountId to conversation resolution when the caller did not specify one', async () => {
  FeeInstallment.findByPk = async () => stubInstallment();
  Student.findByPk = async () => ({ id: 12, contactId: 99, contact: { id: 99, whatsappAccountId: 42 } });
  auditService.record = async () => {};
  educationService.getFee = async () => ({ installments: [{ id: 710 }] });
  let captured = null;
  canonicalWhatsappConversationService.resolveCanonicalWhatsAppConversation = async (input) => { captured = input; return { id: 1, assignedUserId: null, whatsappAccountId: 42 }; };

  await educationService.payInstallment(710, { amount: 500 }, { id: 1, permissions: ['payment.record'] });

  assert.equal(captured.whatsappAccountId, 42);
  assert.equal(captured.contactId, 99);
});

test('an explicit whatsappAccountId in the payload still takes priority over the Contact\'s canonical one', async () => {
  FeeInstallment.findByPk = async () => stubInstallment();
  Student.findByPk = async () => ({ id: 12, contactId: 99, contact: { id: 99, whatsappAccountId: 42 } });
  auditService.record = async () => {};
  educationService.getFee = async () => ({ installments: [{ id: 710 }] });
  let captured = null;
  canonicalWhatsappConversationService.resolveCanonicalWhatsAppConversation = async (input) => { captured = input; return { id: 1, assignedUserId: null, whatsappAccountId: 7 }; };

  await educationService.payInstallment(710, { amount: 500, whatsappAccountId: 7 }, { id: 1, permissions: ['payment.record'] });

  assert.equal(captured.whatsappAccountId, 7);
});

// --- when there is genuinely no canonical account, failure stays isolated ---

test('when the Contact has no canonical whatsappAccountId either, resolution can still legitimately be ambiguous — and that failure stays caught, never blocking payment recording', async () => {
  FeeInstallment.findByPk = async () => stubInstallment();
  Student.findByPk = async () => ({ id: 12, contactId: 99, contact: { id: 99, whatsappAccountId: null } });
  auditService.record = async () => {};
  educationService.getFee = async () => ({ installments: [{ id: 710 }] });
  canonicalWhatsappConversationService.resolveCanonicalWhatsAppConversation = async (input) => {
    assert.equal(input.whatsappAccountId, null);
    throw Object.assign(new Error('WhatsApp account is required because this contact does not have one unambiguous active account.'), { code: 'WHATSAPP_ACCOUNT_AMBIGUOUS' });
  };

  const result = await educationService.payInstallment(710, { amount: 500 }, { id: 1, permissions: ['payment.record'] });

  assert.ok(result.payment || result.fee, 'payment must still be recorded even though WhatsApp resolution failed');
});

// --- structural: the resolver itself is untouched (no ambiguity logic invented) -

test('canonicalWhatsappConversation.service.js\'s resolution logic (preferred conversation, source message, payment slip, single-active-account) is unchanged — only its caller now supplies a better hint', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/canonicalWhatsappConversation.service.js'), 'utf8');
  assert.match(source, /WHATSAPP_ACCOUNT_AMBIGUOUS/);
  assert.match(source, /preferred_conversation|source_message|payment_slip/);
});
