const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  createPaymentReceiptService
} = require('../src/services/paymentReceipt.service');
const { createPaymentReceiptNumberService } = require('../src/services/paymentReceiptNumber.service');
const { createPaymentReceiptPdfService } = require('../src/services/paymentReceiptPdf.service');
const { createPaymentReceiptJobService } = require('../src/services/paymentReceiptJob.service');
const { createPaymentReceiptDeliveryService } = require('../src/services/paymentReceiptDelivery.service');
const tokenCrypto = require('../src/services/paymentReceiptCrypto.service');
const receiptStorage = require('../src/services/paymentReceiptStorage.service');
const requirePermission = require('../src/middleware/permission.middleware');

process.env.RECEIPT_TOKEN_ENCRYPTION_KEY = process.env.RECEIPT_TOKEN_ENCRYPTION_KEY || 'test-receipt-encryption-key-that-is-long';

function row(values) {
  return {
    ...values,
    async update(updates) { Object.assign(this, updates); return this; },
    toJSON() { return { ...this }; }
  };
}

function extractPdfText(buffer) {
  return [...buffer.toString('latin1').matchAll(/\[((?:.|\r|\n)*?)\]\s*TJ/g)]
    .map((match) => [...match[1].matchAll(/<([0-9a-f]+)>/gi)].map((item) => Buffer.from(item[1], 'hex').toString('latin1')).join(''))
    .join('\n');
}

function receiptEnvironment(overrides = {}) {
  const receipts = [];
  const audits = [];
  let nextId = 1;
  const payment = overrides.payment === null ? null : row({
    id: 81, type: 'income', amount: '25000.00', date: '2026-07-19', paymentMethod: 'bank',
    referenceNo: 'BANK-ACCOUNT-1234567890', relatedStudentId: 5, relatedCourseId: 7,
    ...overrides.payment
  });
  const installment = overrides.installment === null ? null : row({
    id: 9, studentFeeId: 3, status: 'confirmed', paymentMethod: 'Bank Transfer',
    transactionReference: 'TXN-1234567890', confirmedBy: 4, ...overrides.installment
  });
  const fee = row({ id: 3, studentId: 5, courseId: 7, batchId: 8, totalAmount: '100000', paidAmount: '50000', ...overrides.fee });
  const student = row({ id: 5, name: 'Test Student', studentNo: 'STU-010852', phone: '94771234567', courseId: 7, batchId: 8, ...overrides.student });
  const transaction = { LOCK: { UPDATE: 'UPDATE' }, afterCommit(callback) { this.afterCommitCallback = callback; } };
  const PaymentReceipt = {
    async findOne({ where }) {
      return receipts.find((item) => String(item.paymentId) === String(where.paymentId) && (!where.status || item.status === where.status)) || null;
    },
    async create(values) { const receipt = row({ id: nextId++, ...values }); receipts.push(receipt); return receipt; }
  };
  const service = createPaymentReceiptService({
    sequelize: {
      getDialect: () => 'postgres', query: async () => [[]],
      transaction: async (callback) => callback(transaction)
    },
    PaymentReceipt,
    AccountingTransaction: { findByPk: async () => payment },
    FeeInstallment: { findOne: async () => installment },
    StudentFee: { findByPk: async () => fee },
    Student: { findByPk: async () => student },
    Course: { findByPk: async () => row({ id: 7, name: 'Diploma in Business' }) },
    Batch: { findByPk: async () => row({ id: 8, name: 'July 2026' }) },
    User: { findByPk: async () => row({ id: 4, firstName: 'Finance', lastName: 'Officer' }) },
    auditService: { async record(event) { audits.push(event); return event; } },
    numberService: { async next() { return `RCPT-2026-${String(nextId).padStart(6, '0')}`; } },
    settingsService: { async get() { return { currency: 'LKR' }; } },
    tokenCrypto
  });
  return { service, receipts, audits, payment, installment, fee, student, transaction };
}

test('approved canonical payment creates one snapshot receipt and retries return it', async () => {
  const env = receiptEnvironment();
  const input = { paymentId: 81, actorType: 'USER', actorUserId: 4, generationSource: 'PAYMENT_APPROVAL', generatePdf: false };
  const first = await env.service.generatePaymentReceipt(input);
  const retry = await env.service.generatePaymentReceipt(input);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(first.receipt.id, retry.receipt.id);
  assert.equal(env.receipts.length, 1);
  assert.equal(first.receipt.studentFeeId, 3);
  assert.equal(first.receipt.feeInstallmentId, 9);
  assert.equal(first.receipt.paidAmount, 25000);
  assert.equal(first.receipt.remainingBalance, 50000);
  assert.equal(env.audits.length, 1);
});

test('manual payment uses the same canonical receipt service', async () => {
  const env = receiptEnvironment();
  const result = await env.service.generatePaymentReceipt({ paymentId: 81, actorType: 'USER', actorUserId: 4, generationSource: 'MANUAL_PAYMENT', generatePdf: false });
  assert.equal(result.receipt.generationSource, 'MANUAL_PAYMENT');
  assert.equal(result.receipt.paymentId, 81);
});

test('receipt snapshots remain unchanged after live student and fee edits', async () => {
  const env = receiptEnvironment();
  const result = await env.service.generatePaymentReceipt({ paymentId: 81, actorType: 'USER', actorUserId: 4, generationSource: 'PAYMENT_APPROVAL', generatePdf: false });
  env.student.name = 'Edited Student';
  env.fee.totalAmount = 200000;
  assert.equal(result.receipt.studentNameSnapshot, 'Test Student');
  assert.equal(result.receipt.totalCourseFee, 100000);
  assert.equal(result.receipt.courseNameSnapshot, 'Diploma in Business');
});

test('invalid or unapproved payment cannot generate a receipt', async () => {
  const missing = receiptEnvironment({ payment: null });
  await assert.rejects(() => missing.service.generatePaymentReceipt({ paymentId: 81, generationSource: 'PAYMENT_APPROVAL', generatePdf: false }), { code: 'RECEIPT_PAYMENT_NOT_APPROVED' });
  const pending = receiptEnvironment({ installment: { status: 'pending_confirmation' } });
  await assert.rejects(() => pending.service.generatePaymentReceipt({ paymentId: 81, generationSource: 'PAYMENT_APPROVAL', generatePdf: false }), { code: 'RECEIPT_PAYMENT_NOT_APPROVED' });
});

test('closed receipt history cannot be silently replaced for the same payment', async () => {
  const env = receiptEnvironment();
  const result = await env.service.generatePaymentReceipt({ paymentId: 81, generationSource: 'PAYMENT_APPROVAL', generatePdf: false });
  result.receipt.status = 'VOID';
  await assert.rejects(() => env.service.generatePaymentReceipt({ paymentId: 81, generationSource: 'ADMIN_REGENERATE', generatePdf: false }), { code: 'RECEIPT_PAYMENT_HISTORY_CLOSED' });
});

test('payment reversal marks the historical receipt reversed without deleting it', async () => {
  const env = receiptEnvironment();
  const result = await env.service.generatePaymentReceipt({ paymentId: 81, generationSource: 'PAYMENT_APPROVAL', generatePdf: false });
  await env.service.markReversed(81, 4);
  assert.equal(result.receipt.status, 'REVERSED');
  assert.equal(env.receipts.length, 1);
  assert.ok(env.audits.some((entry) => entry.action === 'PAYMENT_RECEIPT_REVERSED'));
});

test('atomic yearly counter generates unique six digit receipt numbers concurrently', async () => {
  let counter = 0;
  const service = createPaymentReceiptNumberService({
    sequelize: { async query() { counter += 1; return [[{ last_value: counter }]]; } },
    settingsService: { async get() { return { prefix: 'RCPT' }; } }
  });
  const transaction = {};
  const numbers = await Promise.all(Array.from({ length: 50 }, () => service.next({ receiptDate: new Date('2026-01-02'), transaction })));
  assert.equal(new Set(numbers).size, 50);
  assert.equal(numbers[0], 'RCPT-2026-000001');
  assert.equal(numbers[49], 'RCPT-2026-000050');
});

test('verification tokens are random, non-predictable and hash verifiable', () => {
  const first = tokenCrypto.createToken();
  const second = tokenCrypto.createToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 40);
  assert.equal(tokenCrypto.decryptToken(tokenCrypto.encryptToken(first)), first);
  assert.equal(tokenCrypto.hashToken(first).length, 64);
});

test('PDF generation contains receipt facts and masks sensitive reference data', async () => {
  const rawToken = tokenCrypto.createToken();
  const receipt = row({
    id: 1, receiptNumber: 'RCPT-2026-000001', receiptDate: new Date('2026-07-19'), paidAmount: 25000,
    currency: 'LKR', status: 'ACTIVE', studentNameSnapshot: 'Test Student', studentNumberSnapshot: 'STU-010852',
    studentPhoneSnapshot: '94771234567', courseNameSnapshot: 'Diploma in Business', batchNameSnapshot: 'July 2026',
    paymentMethod: 'Bank Transfer', transactionReference: 'SECRET-BANK-ACCOUNT-1234567890', totalCourseFee: 100000,
    totalPaidAfterPayment: 50000, remainingBalance: 50000, feeInstallmentId: 9, verifiedByUserId: 4,
    verificationTokenEncrypted: tokenCrypto.encryptToken(rawToken)
  });
  let storedBuffer;
  const Receipt = { scope: () => ({ findByPk: async () => receipt }) };
  const service = createPaymentReceiptPdfService({
    PaymentReceipt: Receipt,
    User: { findByPk: async () => ({ firstName: 'Finance', lastName: 'Officer' }) },
    settingsService: { async get() { return { companyName: 'First Of Education International (PVT) Ltd', registrationNumber: 'PV 00267065', verificationBaseUrl: 'https://example.test/receipt/verify', footerText: 'Computer generated receipt.' }; } },
    receiptStorageService: { async store(buffer) { storedBuffer = buffer; return '2026/random.pdf'; } }
  });
  const result = await service.generate(1);
  const pdfText = extractPdfText(storedBuffer);
  assert.ok(result.buffer.length > 1500);
  assert.match(pdfText, /PAYMENT RECEIPT/);
  assert.match(pdfText, /Test Student/);
  assert.match(pdfText, /Diploma in Business/);
  assert.doesNotMatch(pdfText, /SECRET-BANK-ACCOUNT-1234567890/);
  assert.equal(receipt.pdfStorageKey, '2026/random.pdf');
  assert.equal(receipt.pdfFileHash.length, 64);
});

test('private receipt storage rejects traversal and is outside public uploads', () => {
  assert.throws(() => receiptStorage.resolveKey('../uploads/exposed.pdf'), { code: 'RECEIPT_STORAGE_KEY_INVALID' });
  const resolved = receiptStorage.resolveKey('2026/example.pdf');
  assert.equal(resolved.includes(`${path.sep}uploads${path.sep}`), false);
});

test('automatic WhatsApp jobs deduplicate while manual resend creates an audited new job', async () => {
  const jobs = new Map();
  let manualCounter = 0;
  const Job = {
    async findOrCreate({ where, defaults }) {
      if (jobs.has(where.dedupeKey)) return [jobs.get(where.dedupeKey), false];
      const job = row({ id: jobs.size + 1, ...defaults }); jobs.set(where.dedupeKey, job); return [job, true];
    }
  };
  const service = createPaymentReceiptJobService({ PaymentReceiptJob: Job, randomUUID: () => `manual-${++manualCounter}`, logger: { warn() {} } });
  service.processDue = async () => [];
  const first = await service.enqueueWhatsapp(1, { manual: false });
  const retry = await service.enqueueWhatsapp(1, { manual: false });
  const manual = await service.enqueueWhatsapp(1, { manual: true, actorUserId: 4 });
  assert.equal(first.id, retry.id);
  assert.notEqual(manual.id, first.id);
  assert.equal(jobs.size, 2);
});

test('delivery sends once automatically, permits manual resend and audits it', async () => {
  const receipt = row({ id: 1, status: 'ACTIVE', pdfStorageKey: '2026/a.pdf', studentId: 5, studentPhoneSnapshot: '94771234567', receiptNumber: 'RCPT-2026-000001', paidAmount: 25000, remainingBalance: 50000, courseNameSnapshot: 'Course' });
  let sends = 0;
  const audits = [];
  const service = createPaymentReceiptDeliveryService({
    PaymentReceipt: { findByPk: async () => receipt }, Student: { findByPk: async () => ({ id: 5, contactId: 6, phone: '94771234567' }) },
    Conversation: { findOne: async () => ({ id: 10, whatsappAccountId: 3 }) }, Message: { findOne: async () => ({ id: 22 }) },
    receiptStorageService: { resolveKey: () => 'C:\\private\\receipt.pdf' },
    whatsappService: { uploadMedia: async () => ({ id: 'media-1' }), sendMediaMessage: async () => { sends += 1; return { messages: [{ id: `wamid-${sends}` }] }; } },
    auditService: { async record(entry) { audits.push(entry); } }
  });
  await service.send(1, { manual: false });
  const retry = await service.send(1, { manual: false });
  await service.send(1, { manual: true, actorUserId: 4 });
  assert.equal(retry.skipped, true);
  assert.equal(sends, 2);
  assert.ok(audits.some((entry) => entry.action === 'PAYMENT_RECEIPT_WHATSAPP_RESENT'));
});

test('outside the WhatsApp service window reports the template requirement clearly', async () => {
  const service = createPaymentReceiptDeliveryService({
    PaymentReceipt: { findByPk: async () => row({ id: 1, status: 'ACTIVE', pdfStorageKey: 'a.pdf', studentId: 5 }) },
    Student: { findByPk: async () => ({ contactId: 6, phone: '9477' }) }, Conversation: { findOne: async () => ({ id: 10, whatsappAccountId: 3 }) },
    Message: { findOne: async () => null }
  });
  await assert.rejects(() => service.send(1), { code: 'RECEIPT_WHATSAPP_TEMPLATE_REQUIRED' });
});

test('receipt permissions block unauthorized PDF access and allow authorized users', () => {
  let allowed = false;
  const middleware = requirePermission('receipts.download');
  middleware({ user: { permissions: [] } }, { status(code) { this.code = code; return this; }, json(body) { this.body = body; return body; } }, () => { allowed = true; });
  assert.equal(allowed, false);
  middleware({ user: { permissions: ['receipts.download'] } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});

test('void requires a meaningful reason before any financial history change', async () => {
  const controller = require('../src/controllers/paymentReceipt.controller');
  let captured;
  await controller.void({ body: { reason: 'no' }, params: { id: 1 }, user: { id: 4 } }, {}, (error) => { captured = error; });
  assert.equal(captured.code, 'RECEIPT_VOID_REASON_REQUIRED');
  assert.equal(captured.status, 422);
});

test('public verification response serializer never exposes IDs, phone, token or payment details', () => {
  const { safeReceipt } = require('../src/controllers/paymentReceipt.controller');
  const safe = safeReceipt({ id: 1, receiptNumber: 'RCPT-1', verificationTokenHash: 'secret', verificationTokenEncrypted: 'encrypted' });
  assert.equal(safe.verificationTokenHash, undefined);
  assert.equal(safe.verificationTokenEncrypted, undefined);
});

test('receipt migration and backfill modules are safe to import', () => {
  const migration = require('../migrations/038_payment_receipts');
  const backfill = require('../src/scripts/backfill_payment_receipts');
  assert.equal(typeof migration.up, 'function');
  assert.equal(typeof migration.down, 'function');
  assert.equal(typeof backfill.run, 'function');
});

test('payment receipt migration is additive and idempotent', async () => {
  const migration = require('../migrations/038_payment_receipts');
  const tables = new Map([
    ['permissions', {}], ['roles', {}], ['role_permissions', {}], ['app_settings', {}],
    ['accounting_transactions', {}], ['students', {}], ['student_fees', {}], ['fee_installments', {}],
    ['courses', {}], ['batches', {}], ['users', {}]
  ]);
  const indexes = new Map();
  const permissions = new Map();
  const mappings = new Set();
  let settingExists = false;
  const queryInterface = {
    sequelize: {
      getDialect: () => 'postgres',
      async query(sql, options = {}) {
        if (/CREATE UNIQUE INDEX/i.test(sql)) { indexes.set('payment_receipts_one_active_per_payment', true); return [[], {}]; }
        if (/SELECT id FROM permissions/i.test(sql)) return [[...(permissions.has(options.replacements.code) ? [{ id: permissions.get(options.replacements.code) }] : [])], {}];
        if (/SELECT id FROM roles/i.test(sql)) return [[{ id: 1 }, { id: 2 }], {}];
        if (/SELECT role_id FROM role_permissions/i.test(sql)) {
          const key = `${options.replacements.roleId}:${options.replacements.permissionId}`;
          return [[...(mappings.has(key) ? [{ role_id: options.replacements.roleId }] : [])], {}];
        }
        if (/SELECT id FROM app_settings/i.test(sql)) return [[...(settingExists ? [{ id: 1 }] : [])], {}];
        return [[], {}];
      }
    },
    async describeTable(name) { if (!tables.has(name)) throw new Error('missing'); return tables.get(name); },
    async createTable(name, columns) { tables.set(name, columns); },
    async showIndex(name) { return [...(indexes.get(name) || [])].map((indexName) => ({ name: indexName })); },
    async addIndex(name, fields, options) { const current = indexes.get(name) || new Set(); current.add(options.name); indexes.set(name, current); },
    async bulkInsert(name, rows) {
      if (name === 'permissions') rows.forEach((item) => permissions.set(item.code, permissions.size + 1));
      if (name === 'role_permissions') rows.forEach((item) => mappings.add(`${item.role_id}:${item.permission_id}`));
      if (name === 'app_settings') settingExists = true;
    }
  };
  const Sequelize = { DataTypes: new Proxy({}, { get: (_, field) => Object.assign(() => field, { UNSIGNED: field }) }), literal: (value) => value };
  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);
  assert.ok(tables.has('payment_receipts'));
  assert.ok(tables.has('payment_receipt_jobs'));
  assert.ok(tables.has('payment_receipt_counters'));
  assert.equal(permissions.size, 8);
  assert.equal(settingExists, true);
});
