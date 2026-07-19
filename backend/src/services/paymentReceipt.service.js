const { Op } = require('sequelize');
const models = require('../models');
const auditService = require('./audit.service');
const numberService = require('./paymentReceiptNumber.service');
const settingsService = require('./paymentReceiptSettings.service');
const tokenCrypto = require('./paymentReceiptCrypto.service');

const VALID_SOURCES = new Set(['PAYMENT_APPROVAL', 'MANUAL_PAYMENT', 'ADMIN_REGENERATE', 'IMPORT']);
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

function appError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function createPaymentReceiptService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  const PaymentReceipt = dependencies.PaymentReceipt || models.PaymentReceipt;
  const AccountingTransaction = dependencies.AccountingTransaction || models.AccountingTransaction;
  const FeeInstallment = dependencies.FeeInstallment || models.FeeInstallment;
  const StudentFee = dependencies.StudentFee || models.StudentFee;
  const Student = dependencies.Student || models.Student;
  const Course = dependencies.Course || models.Course;
  const Batch = dependencies.Batch || models.Batch;
  const User = dependencies.User || models.User;
  const audit = dependencies.auditService || auditService;
  const receiptNumbers = dependencies.numberService || numberService;
  const settings = dependencies.settingsService || settingsService;
  const tokens = dependencies.tokenCrypto || tokenCrypto;

  async function lockPayment(paymentId, transaction) {
    if (sequelize.getDialect?.() === 'postgres') {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:identity))', {
        replacements: { identity: `payment-receipt:${paymentId}` }, transaction
      });
    }
    return AccountingTransaction.findByPk(paymentId, { transaction, lock: transaction.LOCK?.UPDATE });
  }

  async function run(input, transaction) {
    const paymentId = input.paymentId;
    if (!paymentId) throw appError('A canonical payment is required', 422, 'RECEIPT_PAYMENT_REQUIRED');
    if (!VALID_SOURCES.has(input.generationSource)) throw appError('Invalid receipt generation source', 422, 'RECEIPT_SOURCE_INVALID');

    const payment = await lockPayment(paymentId, transaction);
    if (!payment || payment.type !== 'income' || money(payment.amount) <= 0) {
      throw appError('Only a valid approved income payment can generate a receipt', 409, 'RECEIPT_PAYMENT_NOT_APPROVED');
    }

    const existing = await PaymentReceipt.findOne({
      where: { paymentId, status: 'ACTIVE' }, transaction, lock: transaction.LOCK?.UPDATE
    });
    if (existing) return { receipt: existing, created: false };
    const closedReceipt = await PaymentReceipt.findOne({ where: { paymentId }, transaction, paranoid: false });
    if (closedReceipt) throw appError('This canonical payment already has closed receipt history; create a corrected payment instead', 409, 'RECEIPT_PAYMENT_HISTORY_CLOSED');

    const installment = await FeeInstallment.findOne({
      where: { accountingTransactionId: paymentId }, transaction, lock: transaction.LOCK?.UPDATE
    });
    if (installment && !['confirmed', 'paid'].includes(installment.status)) {
      throw appError('The linked fee payment is not approved', 409, 'RECEIPT_PAYMENT_NOT_APPROVED');
    }
    const fee = installment ? await StudentFee.findByPk(installment.studentFeeId, { transaction }) : null;
    const studentId = fee?.studentId || payment.relatedStudentId;
    if (!studentId) throw appError('Payment has no unambiguous student relationship', 409, 'RECEIPT_STUDENT_AMBIGUOUS');
    const student = await Student.findByPk(studentId, { transaction });
    if (!student) throw appError('Student for payment was not found', 404, 'RECEIPT_STUDENT_NOT_FOUND');
    const courseId = fee?.courseId || payment.relatedCourseId || student.courseId || null;
    const batchId = fee?.batchId || student.batchId || null;
    const [course, batch, verifier, receiptSettings] = await Promise.all([
      courseId ? Course.findByPk(courseId, { transaction }) : null,
      batchId ? Batch.findByPk(batchId, { transaction }) : null,
      installment?.confirmedBy ? User.findByPk(installment.confirmedBy, { transaction }) : null,
      settings.get()
    ]);

    const receiptDate = payment.date ? new Date(`${payment.date}T00:00:00.000Z`) : new Date();
    const receiptNumber = await receiptNumbers.next({ receiptDate, transaction });
    const rawToken = tokens.createToken();
    const totalFee = fee ? money(fee.totalAmount) : null;
    const totalPaid = fee ? money(fee.paidAmount) : money(payment.amount);
    const remaining = totalFee == null ? null : money(Math.max(totalFee - totalPaid, 0));
    const verifierName = verifier ? [verifier.firstName, verifier.lastName].filter(Boolean).join(' ') : null;

    const receipt = await PaymentReceipt.create({
      receiptNumber,
      paymentId: payment.id,
      studentId: student.id,
      studentFeeId: fee?.id || null,
      feeInstallmentId: installment?.id || null,
      courseId,
      batchId,
      receiptDate,
      paidAmount: money(payment.amount),
      currency: receiptSettings.currency || 'LKR',
      paymentMethod: installment?.paymentMethod || payment.paymentMethod || null,
      transactionReference: installment?.transactionReference || payment.referenceNo || null,
      totalCourseFee: totalFee,
      totalPaidAfterPayment: totalPaid,
      remainingBalance: remaining,
      studentNameSnapshot: student.name,
      studentNumberSnapshot: student.studentNo || null,
      studentPhoneSnapshot: student.phone || null,
      courseNameSnapshot: course?.name || null,
      batchNameSnapshot: batch?.name || null,
      payerNameSnapshot: student.name,
      verifiedByUserId: installment?.confirmedBy || null,
      generatedByUserId: input.actorUserId || null,
      generationSource: input.generationSource,
      verificationTokenHash: tokens.hashToken(rawToken),
      verificationTokenEncrypted: tokens.encryptToken(rawToken),
      conversationId: input.conversationId || installment?.sourceConversationId || payment.sourceConversationId || null,
      whatsappAccountId: input.whatsappAccountId || installment?.whatsappAccountId || payment.whatsappAccountId || null,
      status: 'ACTIVE'
    }, { transaction });

    await audit.record({
      userId: input.actorUserId || null,
      action: 'PAYMENT_RECEIPT_GENERATED',
      entityType: 'payment_receipt',
      entityId: receipt.id,
      transaction,
      required: true,
      changes: {
        receiptNumber, paymentId: payment.id, generationSource: input.generationSource,
        actorType: input.actorType || 'USER', verifiedBy: verifierName
      }
    });
    return { receipt, created: true };
  }

  async function enqueueAfterCommit(result, input, transaction) {
    if (!result.created || input.generatePdf === false) return result;
    const enqueue = () => require('./paymentReceiptJob.service').enqueuePdf(result.receipt.id, {
      actorUserId: input.actorUserId || null, manual: false,
      conversationId: result.receipt.conversationId || null,
      whatsappAccountId: result.receipt.whatsappAccountId || null
    }).catch(() => null);
    if (transaction?.afterCommit) transaction.afterCommit(enqueue);
    else setImmediate(enqueue);
    return result;
  }

  return {
    async generatePaymentReceipt(input) {
      if (input.transaction) {
        const result = await run(input, input.transaction);
        return enqueueAfterCommit(result, input, input.transaction);
      }
      let result;
      try {
        result = await sequelize.transaction((transaction) => run(input, transaction));
      } catch (error) {
        const code = error.original?.code || error.parent?.code;
        if (code !== '23505') throw error;
        const receipt = await PaymentReceipt.findOne({ where: { paymentId: input.paymentId, status: 'ACTIVE' } });
        if (!receipt) throw error;
        result = { receipt, created: false };
      }
      return enqueueAfterCommit(result, input, null);
    },

    async markReversed(paymentId, actorUserId, transaction = null) {
      const execute = async (tx) => {
        const receipt = await PaymentReceipt.findOne({ where: { paymentId }, transaction: tx, lock: tx.LOCK?.UPDATE });
        if (!receipt) return null;
        if (receipt.status !== 'REVERSED') await receipt.update({ status: 'REVERSED' }, { transaction: tx });
        await audit.record({ userId: actorUserId, action: 'PAYMENT_RECEIPT_REVERSED', entityType: 'payment_receipt', entityId: receipt.id, transaction: tx, required: true, changes: { paymentId } });
        return receipt;
      };
      return transaction ? execute(transaction) : sequelize.transaction(execute);
    },

    async findPublic(token) {
      if (!token || String(token).length < 32) return null;
      return PaymentReceipt.findOne({ where: { verificationTokenHash: tokens.hashToken(token) } });
    },

    async list(filters = {}) {
      const where = {};
      if (filters.status) where.status = filters.status;
      if (filters.studentId) where.studentId = filters.studentId;
      if (filters.courseId) where.courseId = filters.courseId;
      if (filters.batchId) where.batchId = filters.batchId;
      if (filters.receiptNumber) where.receiptNumber = { [Op.iLike]: `%${filters.receiptNumber}%` };
      if (filters.registrationNumber) where.studentNumberSnapshot = { [Op.iLike]: `%${filters.registrationNumber}%` };
      if (filters.student) where.studentNameSnapshot = { [Op.iLike]: `%${filters.student}%` };
      if (filters.course) where.courseNameSnapshot = { [Op.iLike]: `%${filters.course}%` };
      if (filters.batch) where.batchNameSnapshot = { [Op.iLike]: `%${filters.batch}%` };
      if (filters.whatsapp === 'sent') where.whatsappSentAt = { [Op.ne]: null };
      if (filters.whatsapp === 'not_sent') where.whatsappSentAt = null;
      if (filters.dateFrom || filters.dateTo) where.receiptDate = {
        ...(filters.dateFrom ? { [Op.gte]: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { [Op.lte]: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {})
      };
      return PaymentReceipt.findAll({ where, order: [['receipt_date', 'DESC']], limit: Math.min(Number(filters.limit) || 200, 1000) });
    }
  };
}

const service = createPaymentReceiptService();
module.exports = service;
module.exports.generatePaymentReceipt = service.generatePaymentReceipt.bind(service);
module.exports.createPaymentReceiptService = createPaymentReceiptService;
