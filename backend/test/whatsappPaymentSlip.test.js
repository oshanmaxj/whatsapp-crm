const test = require('node:test');
const assert = require('node:assert/strict');
const Sequelize = require('sequelize');
const models = require('../src/models');
const detector = require('../src/services/paymentSlipDetection.service');
const extraction = require('../src/services/paymentSlipExtraction.service');
const matching = require('../src/services/paymentSlipMatching.service');
const slipService = require('../src/services/paymentSlip.service');
const queueService = require('../src/services/paymentSlipQueue.service');
const messageQueue = require('../src/services/messageQueue.service');
const audit = require('../src/services/audit.service');
const permit = require('../src/middleware/permission.middleware');
const auth = require('../src/middleware/auth.middleware');
const migration = require('../migrations/036_whatsapp_payment_slip_verification');
const { actualMime } = require('../src/services/paymentSlip.service');

function row(values) { return { ...values, toJSON() { return { ...this }; }, async update(changes) { Object.assign(this, changes); return this; } }; }

test('caption plus structured receipt evidence exceeds the PENDING threshold', async () => {
  const result = await detector.detectWhatsAppPaymentSlip({
    message: { text: 'Payment slip attached' }, media: { mimeType: 'image/jpeg' },
    extracted: { amount: 12500, referenceNumber: 'ABC12345', bankName: 'BOC', warnings: [] }, match: { warnings: [] }
  });
  assert.ok(result.confidence >= 0.8);
  assert.equal(result.isLikelyPaymentSlip, true);
});

test('ordinary image without payment context stays below review threshold', async () => {
  const result = await detector.detectWhatsAppPaymentSlip({ message: { text: '' }, media: { mimeType: 'image/png' }, extracted: {}, match: { warnings: [] } });
  assert.ok(result.confidence < 0.5);
  assert.equal(result.isLikelyPaymentSlip, false);
});

test('recent payment request and outstanding installment reach review threshold', async () => {
  const original = models.Message.findAll;
  models.Message.findAll = async () => [{ direction: 'outbound', text: 'Payment reminder: please send your slip' }];
  try {
    const result = await detector.detectWhatsAppPaymentSlip({ message: {}, media: { mimeType: 'image/jpeg' }, conversation: { id: 2 }, extracted: {}, match: { matchedInstallmentId: 8, warnings: [] } });
    assert.ok(result.confidence >= 0.5);
  } finally { models.Message.findAll = original; }
});

test('OCR provider failure returns warnings and never throws', async () => {
  const result = await extraction.extractPaymentSlipFromMedia({ mediaPath: 'unused', mimeType: 'image/jpeg', provider: 'test', adapter: async () => { throw new Error('offline'); } });
  assert.deepEqual(result.warnings, ['OCR_EXTRACTION_FAILED']);
});

test('manual OCR mode remains functional without credentials', async () => {
  const result = await extraction.extractPaymentSlipFromMedia({ mediaPath: 'unused', mimeType: 'application/pdf', provider: 'manual' });
  assert.deepEqual(result.warnings, ['OCR_NOT_CONFIGURED']);
});

test('OCR text parser extracts amount, bank, reference, date and time', () => {
  const result = extraction.extractFields('Commercial Bank Successful Transfer Rs. 12,500.00 Reference: ABC-12345 2026-07-18 14:32');
  assert.equal(result.amount, 12500);
  assert.equal(result.referenceNumber, 'ABC-12345');
  assert.equal(result.bankName, 'commercial bank');
  assert.equal(result.transactionDate, '2026-07-18');
});

test('one clear student and installment are pre-linked', async () => {
  const originals = { students: models.Student.findAll, fees: models.StudentFee.findAll };
  models.Student.findAll = async () => [row({ id: 3, studentNo: 'STU-3', name: 'Student', phone: '94770000000' })];
  models.StudentFee.findAll = async () => [row({ id: 5, balance: 1000, status: 'pending', installments: [row({ id: 7, installmentNo: 1, amount: 1000, paidAmount: 0, dueDate: '2026-07-20', status: 'pending' })] })];
  try {
    const result = await matching.matchPaymentSlipOwner({ contact: { id: 2, phone: '0770000000' } });
    assert.equal(result.matchedStudentId, 3); assert.equal(result.matchedStudentFeeId, 5); assert.equal(result.matchedInstallmentId, 7);
  } finally { models.Student.findAll = originals.students; models.StudentFee.findAll = originals.fees; }
});

test('ambiguous student match stays unlinked and warns finance', async () => {
  const original = models.Student.findAll;
  models.Student.findAll = async () => [row({ id: 1 }), row({ id: 2 })];
  try { const result = await matching.matchPaymentSlipOwner({ contact: { id: 4, phone: '0770000000' } }); assert.equal(result.matchedStudentId, null); assert.ok(result.warnings.includes('AMBIGUOUS_STUDENT_MATCH')); }
  finally { models.Student.findAll = original; }
});

test('detection-job enqueue is idempotent for webhook retries', async () => {
  const original = models.PaymentSlipDetectionJob.findOrCreate;
  let calls = 0; const job = row({ id: 1, messageId: 9 });
  models.PaymentSlipDetectionJob.findOrCreate = async ({ where }) => { calls += 1; assert.equal(where.messageId, 9); return [job, calls === 1]; };
  try { assert.equal(await queueService.enqueue(9), job); assert.equal(await queueService.enqueue(9), job); assert.equal(calls, 2); }
  finally { models.PaymentSlipDetectionJob.findOrCreate = original; }
});

test('exact file hash duplicate is detected before payment creation', async () => {
  const original = models.PaymentSlip.findOne;
  models.PaymentSlip.findOne = async ({ where }) => where.fileHash ? row({ id: 4, fileHash: where.fileHash }) : null;
  try { assert.equal((await slipService.findDuplicate({ fileHash: 'a'.repeat(64) })).id, 4); }
  finally { models.PaymentSlip.findOne = original; }
});

test('duplicate transaction reference is flagged', async () => {
  const original = models.PaymentSlip.findOne;
  models.PaymentSlip.findOne = async ({ where }) => where.referenceNumber ? row({ id: 6, referenceNumber: where.referenceNumber }) : null;
  try { assert.equal((await slipService.findDuplicate({ referenceNumber: 'REF-1' })).id, 6); }
  finally { models.PaymentSlip.findOne = original; }
});

test('manual mark endpoint is idempotent through unique message lookup', async () => {
  const original = models.PaymentSlip.findOne;
  const existing = row({ id: 10, whatsappMessageId: 22 });
  models.PaymentSlip.findOne = async () => existing;
  try { assert.equal((await models.PaymentSlip.findOne({ where: { whatsappMessageId: 22 } })).id, 10); }
  finally { models.PaymentSlip.findOne = original; }
});

test('unauthorized reviewer cannot use approval permission', () => {
  let status; let payload;
  permit('payment-slips.approve')({ user: { permissions: ['payment-slips.view'] } }, { status(value) { status = value; return this; }, json(value) { payload = value; } }, () => assert.fail('must not continue'));
  assert.equal(status, 403); assert.equal(payload.success, false);
});

test('approval creates exactly one accounting payment and updates balances atomically', async () => {
  const originals = {
    transaction: models.sequelize.transaction, slip: models.PaymentSlip.findByPk, installment: models.FeeInstallment.findByPk,
    sum: models.FeeInstallment.sum, fee: models.StudentFee.findByPk, categoryFind: models.AccountingCategory.findOne,
    categoryCreate: models.AccountingCategory.create, paymentFind: models.AccountingTransaction.findOne,
    paymentCreate: models.AccountingTransaction.create, notification: models.Notification.create,
    duplicate: slipService.findDuplicate, get: slipService.get, ack: slipService.queueAcknowledgement, audit: audit.record
  };
  const slip = row({ id: 20, verificationStatus: 'PENDING', studentId: 2, studentFeeId: 3, feeInstallmentId: 4, detectedAmount: 500, transactionDate: '2026-07-18', referenceNumber: 'REF20', decisionAcknowledgementQueuedAt: new Date() });
  const installment = row({ id: 4, studentFeeId: 3, amount: 1000, paidAmount: 0 });
  const fee = row({ id: 3, studentId: 2, totalAmount: 1000, status: 'pending' });
  let creates = 0;
  try {
    models.sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }); models.PaymentSlip.findByPk = async () => slip;
    models.FeeInstallment.findByPk = async () => installment; models.FeeInstallment.sum = async () => 500; models.StudentFee.findByPk = async () => fee;
    models.AccountingCategory.findOne = async () => row({ id: 1 }); models.AccountingCategory.create = async () => row({ id: 1 }); models.AccountingTransaction.findOne = async () => null;
    models.AccountingTransaction.create = async () => { creates += 1; return row({ id: 99 }); }; models.Notification.create = async () => row({});
    slipService.findDuplicate = async () => null; slipService.get = async () => ({ id: 20, fee: { balance: 500 }, student: {} }); slipService.queueAcknowledgement = async () => ({ status: 'skipped' }); audit.record = async () => row({});
    await slipService.approvePaymentSlip({ slipId: 20, reviewerUserId: 1, confirmedAmount: 500, studentId: 2, studentFeeId: 3, installmentAllocation: { installmentId: 4 } });
    assert.equal(creates, 1); assert.equal(slip.verificationStatus, 'APPROVED'); assert.equal(fee.balance, 500); assert.equal(installment.accountingTransactionId, 99);
  } finally { Object.assign(models.sequelize, { transaction: originals.transaction }); models.PaymentSlip.findByPk = originals.slip; models.FeeInstallment.findByPk = originals.installment; models.FeeInstallment.sum = originals.sum; models.StudentFee.findByPk = originals.fee; models.AccountingCategory.findOne = originals.categoryFind; models.AccountingCategory.create = originals.categoryCreate; models.AccountingTransaction.findOne = originals.paymentFind; models.AccountingTransaction.create = originals.paymentCreate; models.Notification.create = originals.notification; slipService.findDuplicate = originals.duplicate; slipService.get = originals.get; slipService.queueAcknowledgement = originals.ack; audit.record = originals.audit; }
});

test('repeated approval returns the existing payment without creating another', async () => {
  const originals = { transaction: models.sequelize.transaction, slip: models.PaymentSlip.findByPk, create: models.AccountingTransaction.create, get: slipService.get };
  let creates = 0; const approved = row({ id: 30, verificationStatus: 'APPROVED', approvedPaymentId: 88, decisionAcknowledgementQueuedAt: new Date() });
  try { models.sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }); models.PaymentSlip.findByPk = async () => approved; models.AccountingTransaction.create = async () => { creates += 1; }; slipService.get = async () => approved; await slipService.approvePaymentSlip({ slipId: 30, reviewerUserId: 1 }); assert.equal(creates, 0); }
  finally { models.sequelize.transaction = originals.transaction; models.PaymentSlip.findByPk = originals.slip; models.AccountingTransaction.create = originals.create; slipService.get = originals.get; }
});

test('rejection never updates fee or installment balances', async () => {
  const originals = { transaction: models.sequelize.transaction, slip: models.PaymentSlip.findByPk, fee: models.StudentFee.update, installment: models.FeeInstallment.update, audit: audit.record, ack: slipService.queueAcknowledgement, get: slipService.get };
  let balanceWrites = 0; const slip = row({ id: 40, verificationStatus: 'PENDING' });
  try { models.sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }); models.PaymentSlip.findByPk = async () => slip; models.StudentFee.update = async () => { balanceWrites += 1; }; models.FeeInstallment.update = async () => { balanceWrites += 1; }; audit.record = async () => row({}); slipService.queueAcknowledgement = async () => ({}); slipService.get = async () => slip; await slipService.decide(40, 'reject', { reason: 'Unreadable' }, 1); assert.equal(balanceWrites, 0); assert.equal(slip.verificationStatus, 'REJECTED'); }
  finally { models.sequelize.transaction = originals.transaction; models.PaymentSlip.findByPk = originals.slip; models.StudentFee.update = originals.fee; models.FeeInstallment.update = originals.installment; audit.record = originals.audit; slipService.queueAcknowledgement = originals.ack; slipService.get = originals.get; }
});

test('WhatsApp acknowledgement is claimed and sent only once', async () => {
  const originals = { update: models.PaymentSlip.update, message: models.Message.findByPk, enqueue: messageQueue.enqueue };
  let claimed = false; let sent = 0; const slip = row({ id: 50, whatsappMessageId: 5, acknowledgementQueuedAt: null });
  try { models.PaymentSlip.update = async (values) => { if (values.acknowledgementQueuedAt && !claimed) { claimed = true; return [1]; } return [0]; }; models.Message.findByPk = async () => ({ fromNumber: '94770000000' }); messageQueue.enqueue = async () => { sent += 1; }; await slipService.queueAcknowledgement(slip, 'detected'); slip.acknowledgementQueuedAt = null; await slipService.queueAcknowledgement(slip, 'detected'); assert.equal(sent, 1); }
  finally { models.PaymentSlip.update = originals.update; models.Message.findByPk = originals.message; messageQueue.enqueue = originals.enqueue; }
});

test('unsupported file signatures are rejected safely', () => {
  assert.equal(actualMime(Buffer.from('not a receipt')), null);
  assert.equal(actualMime(Buffer.from('%PDF-1.7')), 'application/pdf');
});

test('private file endpoint requires authentication before authorization', () => {
  let error;
  auth.authenticate({ headers: {} }, {}, (value) => { error = value; });
  assert.equal(error.status, 401); assert.equal(error.code, 'AUTH_REQUIRED');
});

test('payment-slip migration is additive and idempotent', async () => {
  const tables = { permissions: {}, roles: {}, role_permissions: {} }; const indexes = []; const permissions = new Map();
  const qi = {
    async describeTable(name) { if (!tables[name]) throw new Error('missing'); return tables[name]; },
    async createTable(name, columns) { tables[name] = columns; }, async addIndex(table, fields, options) { indexes.push(options.name); },
    async bulkInsert(table, rows) { if (table === 'permissions') rows.forEach((item, index) => permissions.set(item.code, index + 1)); },
    sequelize: { async query(sql, options = {}) { if (sql.startsWith('SELECT id FROM permissions')) { const id = permissions.get(options.replacements.code); return [id ? [{ id }] : []]; } if (sql.startsWith('SELECT id, lower')) return [[]]; return [[]]; } }
  };
  await migration.up(qi, Sequelize); await migration.up(qi, Sequelize);
  assert.ok(tables.payment_slips.whatsapp_message_id); assert.ok(tables.payment_slip_detection_jobs.message_id);
  assert.equal(indexes.filter((name) => name === 'payment_slips_whatsapp_message_unique').length, 1);
});
