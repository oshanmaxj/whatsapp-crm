const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Op } = require('sequelize');
const {
  sequelize, PaymentSlip, PaymentSlipDetectionJob, Message, Media, Conversation, Contact, Lead, Student,
  StudentFee, StudentEnrollment, FeeInstallment, Course, Batch, AccountingCategory, AccountingTransaction, Notification
} = require('../models');
const { extractPaymentSlipFromMedia } = require('./paymentSlipExtraction.service');
const { matchPaymentSlipOwner } = require('./paymentSlipMatching.service');
const { detectWhatsAppPaymentSlip } = require('./paymentSlipDetection.service');
const messageQueueService = require('./messageQueue.service');
const auditService = require('./audit.service');
const educationService = require('./education.service');
const logger = require('../config/logger');

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const REVIEWABLE = ['PENDING', 'NEEDS_REVIEW'];
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const safeError = (message, status, code) => Object.assign(new Error(message), { status, code });

function actualMime(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

function maskAccount(value) {
  const clean = String(value || '');
  return clean ? `${'*'.repeat(Math.max(clean.length - 4, 4))}${clean.slice(-4)}` : null;
}

function publicSlip(row, detailed = false) {
  const json = row?.toJSON ? row.toJSON() : { ...row };
  if (!json) return json;
  delete json.fileUrl;
  json.destinationBankAccount = maskAccount(json.destinationBankAccount);
  if (!detailed) delete json.ocrRawText;
  json.previewUrl = `/api/payment-slips/${json.id}/file`;
  return json;
}

async function fileEvidence(media) {
  if (!media?.storagePath) throw safeError('Payment slip media is unavailable.', 422, 'SLIP_MEDIA_MISSING');
  const buffer = await fs.readFile(media.storagePath);
  const max = Number(process.env.PAYMENT_SLIP_MAX_FILE_MB || 10) * 1024 * 1024;
  if (buffer.length > max) throw safeError('Payment slip exceeds the configured file-size limit.', 413, 'SLIP_FILE_TOO_LARGE');
  const detectedMime = actualMime(buffer);
  const claimed = String(media.mimeType || '').toLowerCase().split(';')[0];
  if (!SUPPORTED.has(detectedMime) || (claimed && claimed !== detectedMime)) throw safeError('Only genuine JPEG, PNG, and PDF payment slips are supported.', 415, 'SLIP_UNSUPPORTED_FILE');
  return { hash: crypto.createHash('sha256').update(buffer).digest('hex'), mimeType: detectedMime, size: buffer.length };
}

async function privatizeMedia({ media, message, slip, evidence, transaction }) {
  const root = path.resolve(process.env.PAYMENT_SLIP_PRIVATE_ROOT || path.join(__dirname, '..', '..', 'private', 'payment-slips'));
  await fs.mkdir(root, { recursive: true });
  const extension = evidence.mimeType === 'application/pdf' ? '.pdf' : evidence.mimeType === 'image/png' ? '.png' : '.jpg';
  const target = path.join(root, `${slip.id}-${evidence.hash.slice(0, 16)}${extension}`);
  const source = path.resolve(media.storagePath);
  if (source !== target) {
    try { await fs.rename(source, target); }
    catch (_) { await fs.copyFile(source, target); await fs.unlink(source).catch(() => {}); }
  }
  await media.update({ storagePath: target, publicUrl: null }, { transaction });
  await message.update({ mediaUrl: null }, { transaction });
  await slip.update({ fileUrl: target }, { transaction });
  return target;
}

class PaymentSlipService {
  async feeOptions(studentId) {
    const student = await Student.findByPk(studentId, { attributes: ['id', 'studentNo', 'name'] });
    if (!student) throw safeError('Student not found.', 404, 'STUDENT_NOT_FOUND');
    const [fees, enrollments] = await Promise.all([
      StudentFee.findAll({
        where: { studentId, status: { [Op.in]: ['pending', 'partial', 'overdue'] } },
        include: [{ model: Course, as: 'course', attributes: ['id', 'name', 'feeAmount', 'defaultInstallmentCount'], required: false }],
        order: [['created_at', 'DESC']]
      }),
      StudentEnrollment.findAll({
        where: { studentId, enrollmentStatus: 'active' },
        include: [
          { model: Course, as: 'course', attributes: ['id', 'name', 'feeAmount', 'defaultInstallmentCount'], required: false },
          { model: StudentFee, as: 'fees', attributes: ['id'], where: { status: { [Op.ne]: 'cancelled' } }, required: false }
        ],
        order: [['enrolled_at', 'DESC']]
      })
    ]);
    const options = fees
      .filter((fee) => !['paid', 'free', 'cancelled'].includes(fee.status) && money(fee.balance) > 0)
      .map((fee) => ({
        id: fee.id,
        courseName: fee.course?.name || 'Course',
        totalAmount: money(fee.totalAmount),
        paidAmount: money(fee.paidAmount),
        remainingBalance: money(fee.balance),
        status: fee.status
      }));
    return {
      student: { id: student.id, studentNo: student.studentNo, name: student.name },
      options,
      autoSelectId: options.length === 1 ? options[0].id : null,
      enrollments: enrollments.filter((enrollment) => !(enrollment.fees || []).length).map((enrollment) => ({
        id: enrollment.id,
        courseName: enrollment.course?.name || 'Course',
        courseFee: money(enrollment.course?.feeAmount),
        defaultInstallmentCount: Math.max(Number(enrollment.course?.defaultInstallmentCount) || 1, 1)
      }))
    };
  }

  async outstandingInstallmentOptions(studentFeeId) {
    const fee = await StudentFee.findByPk(studentFeeId, { attributes: ['id', 'studentId', 'status', 'balance'] });
    if (!fee) throw safeError('Student fee not found.', 404, 'STUDENT_FEE_NOT_FOUND');
    const rows = await FeeInstallment.findAll({
      where: { studentFeeId, status: { [Op.in]: ['pending', 'due_soon', 'due_today', 'partially_paid', 'overdue', 'rejected'] } },
      order: [['due_date', 'ASC'], ['installment_no', 'ASC']]
    });
    const options = rows.map((item) => ({
      id: item.id,
      installmentNo: item.installmentNo,
      amount: money(item.amount),
      paidAmount: money(item.paidAmount),
      remainingBalance: money(Math.max(Number(item.amount) - Number(item.paidAmount), 0)),
      dueDate: item.dueDate,
      status: item.status
    })).filter((item) => item.remainingBalance > 0);
    return {
      studentFeeId: fee.id,
      options,
      autoSelectId: options.length === 1 ? options[0].id : null,
      suggestedConfirmedAmount: options.length === 1 ? options[0].remainingBalance : null
    };
  }

  async createFeePlan(studentId, payload = {}, actor = null) {
    const current = await this.feeOptions(studentId);
    if (current.options.length) throw safeError('An active fee record already exists for this student.', 409, 'ACTIVE_FEE_EXISTS');
    const enrollment = payload.enrollmentId
      ? current.enrollments.find((item) => String(item.id) === String(payload.enrollmentId))
      : current.enrollments.length === 1 ? current.enrollments[0] : null;
    if (!enrollment) {
      throw safeError(current.enrollments.length ? 'Select an active enrollment before creating the fee plan.' : 'No active enrollment is available for this student.', 422, 'ACTIVE_ENROLLMENT_REQUIRED');
    }
    return educationService.createFee({
      studentId,
      enrollmentId: enrollment.id,
      paymentType: enrollment.defaultInstallmentCount > 1 ? 'installment' : 'full',
      installmentCount: enrollment.defaultInstallmentCount,
      originalAmount: enrollment.courseFee,
      dueDate: payload.dueDate || new Date().toISOString().slice(0, 10),
      notes: 'Created from Payment Slip Review'
    }, actor);
  }

  async generateInstallments(studentFeeId) {
    const fee = await educationService.getFee(studentFeeId);
    if ((fee.installments || []).length) throw safeError('An installment plan already exists.', 409, 'INSTALLMENTS_ALREADY_EXIST');
    return educationService.updateFee(studentFeeId, {
      paymentType: fee.paymentType,
      installmentCount: fee.paymentType === 'installment' ? Math.max(Number(fee.installmentCount || fee.course?.defaultInstallmentCount) || 1, 1) : 1,
      dueDate: fee.dueDate || new Date().toISOString().slice(0, 10)
    });
  }

  async messageContext(messageId, transaction) {
    const message = await Message.findByPk(messageId, { transaction });
    if (!message || message.direction !== 'inbound' || !['image', 'document'].includes(message.type)) throw safeError('Inbound image or PDF message not found.', 404, 'SLIP_MESSAGE_NOT_FOUND');
    const media = await Media.findOne({ where: { messageId: message.id }, transaction });
    const conversation = message.conversationId ? await Conversation.findByPk(message.conversationId, { transaction }) : null;
    const contact = message.contactId ? await Contact.findByPk(message.contactId, { transaction }) : conversation?.contactId ? await Contact.findByPk(conversation.contactId, { transaction }) : null;
    const lead = conversation?.leadId ? await Lead.findByPk(conversation.leadId, { transaction }) : null;
    return { message, media, conversation, contact, lead };
  }

  async enqueue(messageId) {
    if (process.env.PAYMENT_SLIP_DETECTION_ENABLED === 'false') return null;
    const [job] = await PaymentSlipDetectionJob.findOrCreate({ where: { messageId }, defaults: { messageId, status: 'QUEUED' } });
    return job;
  }

  async findDuplicate({ messageId, fileHash, referenceNumber, transaction, excludeId }) {
    const base = excludeId ? { id: { [Op.ne]: excludeId } } : {};
    if (messageId) {
      const exactMessage = await PaymentSlip.findOne({ where: { ...base, whatsappMessageId: messageId }, transaction, paranoid: false });
      if (exactMessage) return exactMessage;
    }
    if (fileHash) {
      const exactFile = await PaymentSlip.findOne({ where: { ...base, fileHash }, transaction, order: [['created_at', 'ASC']] });
      if (exactFile) return exactFile;
    }
    if (referenceNumber) {
      const exactReference = await PaymentSlip.findOne({ where: { ...base, referenceNumber, verificationStatus: { [Op.in]: ['PENDING', 'NEEDS_REVIEW', 'APPROVED'] } }, transaction, order: [['created_at', 'ASC']] });
      if (exactReference) return exactReference;
    }
    return null;
  }

  async detectMessage(messageId, { force = false, transaction = null } = {}) {
    const run = async (tx) => {
      const existing = await PaymentSlip.findOne({ where: { whatsappMessageId: messageId }, transaction: tx, paranoid: false });
      if (existing && !force) return existing;
      if (existing && force && !REVIEWABLE.includes(existing.verificationStatus)) throw safeError('Processed payment slips cannot be rerun.', 409, 'PAYMENT_SLIP_ALREADY_PROCESSED');
      const { message, media, conversation, contact, lead } = await this.messageContext(messageId, tx);
      if (!media) throw safeError('The WhatsApp media attachment has not been stored.', 422, 'SLIP_MEDIA_MISSING');
      const evidence = await fileEvidence(media);
      const match = await matchPaymentSlipOwner({ contact, lead, conversation, transaction: tx });
      const extracted = await extractPaymentSlipFromMedia({ mediaPath: media.storagePath, mimeType: evidence.mimeType });
      const detection = await detectWhatsAppPaymentSlip({ message, media: { ...media.toJSON(), mimeType: evidence.mimeType }, conversation, contact, extracted, match, transaction: tx });
      const autoThreshold = Number(process.env.WHATSAPP_SLIP_AUTO_CREATE_THRESHOLD || 0.80);
      const reviewThreshold = Number(process.env.WHATSAPP_SLIP_REVIEW_THRESHOLD || 0.50);
      if (!force && detection.confidence < reviewThreshold) return null;
      const duplicate = await this.findDuplicate({ fileHash: evidence.hash, referenceNumber: detection.extractedData.referenceNumber, transaction: tx, excludeId: existing?.id });
      let status = duplicate ? 'DUPLICATE' : detection.confidence >= autoThreshold ? 'PENDING' : 'NEEDS_REVIEW';
      if (force && !duplicate) status = 'NEEDS_REVIEW';
      if (detection.warnings.some((warning) => String(warning).startsWith('AMBIGUOUS_')) && status === 'PENDING') status = 'NEEDS_REVIEW';
      const values = {
        studentId: detection.matchedStudentId, leadId: lead?.id || null, contactId: contact?.id || null,
        conversationId: conversation?.id || null, whatsappMessageId: message.id, whatsappAccountId: message.whatsappAccountId,
        studentFeeId: detection.matchedStudentFeeId, feeInstallmentId: detection.matchedInstallmentId, source: 'WHATSAPP', mediaId: media.id,
        fileUrl: media.storagePath, originalFilename: media.originalName || media.fileName, mimeType: evidence.mimeType, fileSize: evidence.size,
        fileHash: evidence.hash, messageCaption: message.text || media.caption || null, detectionConfidence: detection.confidence,
        detectionSignals: detection.signals, detectionWarnings: detection.warnings, matchCandidates: match.candidates,
        detectedAmount: detection.extractedData.amount, detectedBank: detection.extractedData.bankName,
        destinationBankAccount: detection.extractedData.destinationAccount, referenceNumber: detection.extractedData.referenceNumber,
        transactionDate: detection.extractedData.transactionDate, transactionTime: detection.extractedData.transactionTime,
        payerName: detection.extractedData.payerName, ocrRawText: extracted.rawText || null,
        ocrData: { fieldsConfidence: extracted.fieldsConfidence || {}, warnings: extracted.warnings || [] }, ocrConfidence: extracted.confidence,
        verificationStatus: status, duplicateOfSlipId: duplicate?.id || null
      };
      const slip = existing ? await existing.update(values, { transaction: tx }) : await PaymentSlip.create(values, { transaction: tx });
      await privatizeMedia({ media, message, slip, evidence, transaction: tx });
      await Notification.create({ type: 'payment_slip_detected', title: 'WhatsApp payment slip received', message: `Slip #${slip.id} requires finance verification.`, data: { slipId: slip.id, status } }, { transaction: tx });
      return slip;
    };
    const slip = transaction ? await run(transaction) : await sequelize.transaction(run);
    if (slip && slip.verificationStatus !== 'DUPLICATE') await this.queueAcknowledgement(slip, 'detected');
    return slip;
  }

  async queueAcknowledgement(slip, kind, message) {
    const enabled = process.env.PAYMENT_SLIP_ACKNOWLEDGEMENT_ENABLED !== 'false';
    const field = kind === 'decision' ? 'decisionAcknowledgementQueuedAt' : 'acknowledgementQueuedAt';
    if (!enabled || slip[field]) return { status: 'skipped' };
    const [claimed] = await PaymentSlip.update({ [field]: new Date() }, { where: { id: slip.id, [field]: null } });
    if (!claimed) return { status: 'skipped' };
    const source = await Message.findByPk(slip.whatsappMessageId);
    if (!source?.fromNumber) { await PaymentSlip.update({ [field]: null }, { where: { id: slip.id } }); return { status: 'skipped' }; }
    const text = message || 'ඔබගේ payment slip එක ලැබුණා. එය පරීක්ෂා කිරීම සඳහා යොමු කර ඇත.';
    try { await messageQueueService.enqueue({ channel: 'whatsapp', messageType: 'text', to: source.fromNumber, whatsappAccountId: slip.whatsappAccountId, payload: { text, paymentSlipId: slip.id, acknowledgementType: kind } }); }
    catch (error) { await PaymentSlip.update({ [field]: null }, { where: { id: slip.id } }); throw error; }
    slip[field] = new Date();
    return { status: 'queued' };
  }

  async list(query = {}) {
    const where = {};
    if (query.status && query.status !== 'ALL') where.verificationStatus = String(query.status).toUpperCase();
    const rows = await PaymentSlip.findAll({ where, order: [['created_at', 'DESC']], limit: Math.min(Number(query.limit) || 100, 500) });
    return Promise.all(rows.map(async (row) => this.enrich(row, false)));
  }

  async enrich(row, detailed) {
    const [contact, student, fee, installment] = await Promise.all([
      row.contactId ? Contact.findByPk(row.contactId, { attributes: ['id', 'firstName', 'lastName', 'phone'] }) : null,
      row.studentId ? Student.findByPk(row.studentId, { attributes: ['id', 'studentNo', 'name', 'courseId', 'batchId'] }) : null,
      row.studentFeeId ? StudentFee.findByPk(row.studentFeeId) : null,
      row.feeInstallmentId ? FeeInstallment.findByPk(row.feeInstallmentId) : null
    ]);
    const [course, batch] = await Promise.all([student?.courseId ? Course.findByPk(student.courseId, { attributes: ['id', 'name'] }) : null, student?.batchId ? Batch.findByPk(student.batchId, { attributes: ['id', 'name'] }) : null]);
    const recentContext = detailed && row.conversationId ? await Message.findAll({
      where: { conversationId: row.conversationId }, attributes: ['id', 'direction', 'type', 'text', 'createdAt'],
      order: [['created_at', 'DESC']], limit: 12
    }) : [];
    return { ...publicSlip(row, detailed), contact, student: student ? { ...student.toJSON(), course, batch } : null, fee, installment, recentContext };
  }

  async get(id, detailed = true) {
    const row = await PaymentSlip.findByPk(id);
    if (!row) throw safeError('Payment slip not found.', 404, 'PAYMENT_SLIP_NOT_FOUND');
    return this.enrich(row, detailed);
  }

  async file(id) {
    const row = await PaymentSlip.findByPk(id);
    if (!row?.fileUrl) throw safeError('Payment slip file not found.', 404, 'SLIP_MEDIA_MISSING');
    const resolved = path.resolve(row.fileUrl);
    const privateRoot = path.resolve(process.env.PAYMENT_SLIP_PRIVATE_ROOT || path.join(__dirname, '..', '..', 'private', 'payment-slips'));
    if (resolved !== privateRoot && !resolved.startsWith(`${privateRoot}${path.sep}`)) throw safeError('Payment slip file reference is invalid.', 403, 'SLIP_FILE_ACCESS_DENIED');
    await fs.access(resolved);
    return { row, path: resolved, name: row.originalFilename || `payment-slip-${row.id}`, mimeType: row.mimeType };
  }

  async approvePaymentSlip({ slipId, reviewerUserId, confirmedAmount, studentId, studentFeeId, installmentAllocation, note }) {
    let result;
    await sequelize.transaction(async (transaction) => {
      const slip = await PaymentSlip.findByPk(slipId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!slip) throw safeError('Payment slip not found.', 404, 'PAYMENT_SLIP_NOT_FOUND');
      if (slip.verificationStatus === 'APPROVED' && slip.approvedPaymentId) { result = slip; return; }
      if (!REVIEWABLE.includes(slip.verificationStatus)) throw safeError(`Slip cannot be approved from ${slip.verificationStatus}.`, 409, 'PAYMENT_SLIP_ALREADY_PROCESSED');
      const duplicate = await this.findDuplicate({ fileHash: slip.fileHash, referenceNumber: slip.referenceNumber, transaction, excludeId: slip.id });
      if (duplicate?.verificationStatus === 'APPROVED') throw safeError(`Possible duplicate of approved slip #${duplicate.id}.`, 409, 'PAYMENT_SLIP_DUPLICATE');
      const installmentId = installmentAllocation?.installmentId || slip.feeInstallmentId;
      const installment = installmentId ? await FeeInstallment.findByPk(installmentId, { transaction, lock: transaction.LOCK.UPDATE }) : null;
      if (!installment) throw safeError('Select one installment before approval.', 422, 'INSTALLMENT_REQUIRED');
      const fee = await StudentFee.findByPk(studentFeeId || slip.studentFeeId || installment.studentFeeId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!fee || String(fee.id) !== String(installment.studentFeeId)) throw safeError('Selected fee and installment do not match.', 422, 'FEE_INSTALLMENT_MISMATCH');
      const selectedStudentId = studentId || slip.studentId || fee.studentId;
      if (String(fee.studentId) !== String(selectedStudentId)) throw safeError('Selected student and fee do not match.', 422, 'STUDENT_FEE_MISMATCH');
      const amount = money(confirmedAmount ?? slip.detectedAmount);
      const remaining = money(Number(installment.amount) - Number(installment.paidAmount));
      if (!(amount > 0) || amount > remaining) throw safeError('Confirmed amount must be positive and cannot exceed the installment balance.', 422, 'INVALID_CONFIRMED_AMOUNT');
      const date = slip.transactionDate || new Date().toISOString().slice(0, 10);
      const existingPayment = await AccountingTransaction.findOne({ where: { relatedStudentId: selectedStudentId, date, amount }, transaction });
      if (existingPayment) throw safeError(`A matching approved payment already exists (#${existingPayment.id}).`, 409, 'PAYMENT_SLIP_DUPLICATE');
      let category = await AccountingCategory.findOne({ where: { name: 'Course Fees', type: 'income' }, transaction });
      if (!category) category = await AccountingCategory.create({ name: 'Course Fees', type: 'income', description: 'Confirmed student fee payments', isActive: true }, { transaction });
      const payment = await AccountingTransaction.create({
        type: 'income', date, amount, categoryId: category.id,
        paymentMethod: 'bank', referenceNo: slip.referenceNumber || `WHATSAPP-SLIP-${slip.id}`,
        description: `Verified WhatsApp payment slip #${slip.id}`, relatedStudentId: selectedStudentId, createdBy: reviewerUserId
      }, { transaction });
      const installmentPaid = money(Number(installment.paidAmount) + amount);
      await installment.update({ paidAmount: installmentPaid, pendingPaymentAmount: null, paidDate: date, paymentMethod: 'Bank Transfer', transactionReference: slip.referenceNumber, status: 'confirmed', confirmedBy: reviewerUserId, confirmedAt: new Date(), accountingTransactionId: payment.id }, { transaction });
      const feePaid = money(await FeeInstallment.sum('paidAmount', { where: { studentFeeId: fee.id }, transaction }));
      const balance = money(Math.max(Number(fee.totalAmount) - feePaid, 0));
      await fee.update({ paidAmount: feePaid, balance, status: balance <= 0 ? 'paid' : feePaid > 0 ? 'partial' : fee.status }, { transaction });
      await slip.update({ studentId: selectedStudentId, studentFeeId: fee.id, feeInstallmentId: installment.id, confirmedAmount: amount, reviewerNote: note || null, verificationStatus: 'APPROVED', reviewedByUserId: reviewerUserId, reviewedAt: new Date(), approvedPaymentId: payment.id }, { transaction });
      await auditService.record({ userId: reviewerUserId, action: 'PAYMENT_SLIP_APPROVED', entityType: 'payment_slip', entityId: slip.id, changes: { paymentId: payment.id, studentId: selectedStudentId, feeId: fee.id, installmentId: installment.id, amount }, transaction, required: true });
      await Notification.create({ userId: reviewerUserId, type: 'payment_slip_approved', title: 'Payment slip approved', message: `Payment slip #${slip.id} was approved.`, data: { slipId: slip.id, paymentId: payment.id } }, { transaction });
      result = slip;
    });
    if (!result.decisionAcknowledgementQueuedAt) {
      const enriched = await this.get(result.id);
      const remaining = enriched.fee?.balance ?? 0;
      await this.queueAcknowledgement(result, 'decision', `ඔබගේ රු. ${result.confirmedAmount} ගෙවීම තහවුරු කර ඇත.\nRegistration No: ${enriched.student?.studentNo || '-'}\nCourse: ${enriched.student?.course?.name || '-'}\nRemaining Balance: රු. ${remaining}`);
    }
    return this.get(result.id);
  }

  async decide(id, action, payload, reviewerUserId) {
    if (!['reject', 'duplicate'].includes(action)) throw safeError('Invalid payment-slip action.', 422, 'INVALID_SLIP_ACTION');
    let slip;
    await sequelize.transaction(async (transaction) => {
      slip = await PaymentSlip.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!slip) throw safeError('Payment slip not found.', 404, 'PAYMENT_SLIP_NOT_FOUND');
      if (!REVIEWABLE.includes(slip.verificationStatus)) throw safeError('Payment slip has already been processed.', 409, 'PAYMENT_SLIP_ALREADY_PROCESSED');
      const status = action === 'reject' ? 'REJECTED' : 'DUPLICATE';
      await slip.update({ verificationStatus: status, rejectionReason: action === 'reject' ? String(payload.reason || '').trim() || 'Unable to verify payment' : null, duplicateOfSlipId: action === 'duplicate' ? payload.duplicateOfSlipId || null : null, reviewerNote: payload.note || null, reviewedByUserId: reviewerUserId, reviewedAt: new Date() }, { transaction });
      await auditService.record({ userId: reviewerUserId, action: `PAYMENT_SLIP_${status}`, entityType: 'payment_slip', entityId: slip.id, changes: { reason: slip.rejectionReason, duplicateOfSlipId: slip.duplicateOfSlipId }, transaction, required: true });
    });
    if (action === 'reject') await this.queueAcknowledgement(slip, 'decision', `ඔබ එවූ payment slip එක තහවුරු කළ නොහැකි විය.\nReason: ${slip.rejectionReason}\nකරුණාකර නිවැරදි slip එක නැවත එවන්න.`);
    return this.get(id);
  }
}

module.exports = new PaymentSlipService();
module.exports.publicSlip = publicSlip;
module.exports.actualMime = actualMime;
