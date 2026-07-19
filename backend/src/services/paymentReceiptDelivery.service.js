const { Op } = require('sequelize');
const { Message, PaymentReceipt, Student } = require('../models');
const whatsappService = require('./whatsapp.service');
const receiptStorageService = require('./paymentReceiptStorage.service');
const auditService = require('./audit.service');
const canonicalConversationService = require('./canonicalWhatsappConversation.service');
const outboundHistoryService = require('./outboundHistory.service');

function caption(receipt) {
  const amount = Number(receipt.paidAmount || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 });
  const balance = Number(receipt.remainingBalance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 });
  return `ඔබගේ ගෙවීම සාර්ථකව තහවුරු කර ඇත ✅\n\nReceipt No: ${receipt.receiptNumber}\nAmount: රු. ${amount}\nCourse: ${receipt.courseNameSnapshot || '-'}\nRemaining Balance: රු. ${balance}\n\nඔබගේ receipt එක පහතින් ලබාගන්න.`;
}

class PaymentReceiptDeliveryService {
  constructor(dependencies = {}) {
    this.PaymentReceipt = dependencies.PaymentReceipt || PaymentReceipt;
    this.Student = dependencies.Student || Student;
    this.Message = dependencies.Message || Message;
    this.whatsappService = dependencies.whatsappService || whatsappService;
    this.receiptStorageService = dependencies.receiptStorageService || receiptStorageService;
    this.auditService = dependencies.auditService || auditService;
    this.canonicalConversationService = dependencies.canonicalConversationService || canonicalConversationService;
    this.outboundHistoryService = dependencies.outboundHistoryService || outboundHistoryService;
  }

  async resolveContext(receipt, preferred = {}) {
    const student = await this.Student.findByPk(receipt.studentId);
    if (!student?.contactId) throw Object.assign(new Error('Receipt student has no CRM contact'), { status: 409, code: 'RECEIPT_CONTACT_REQUIRED' });
    const conversation = await this.canonicalConversationService.resolveCanonicalWhatsAppConversation({
      preferredConversationId: preferred.conversationId || receipt.conversationId || null,
      contactId: student.contactId,
      whatsappAccountId: preferred.whatsappAccountId || receipt.whatsappAccountId || null
    });
    const recentInbound = await this.Message.findOne({
      where: { conversationId: conversation.id, direction: 'inbound', createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      order: [['created_at', 'DESC']]
    });
    if (!recentInbound) {
      throw Object.assign(new Error('Receipt delivery is pending: an approved WhatsApp template is required outside the customer-service window'), { status: 409, code: 'RECEIPT_WHATSAPP_TEMPLATE_REQUIRED' });
    }
    return { student, conversation };
  }

  async preflight(receiptId, preferred = {}) {
    const receipt = await this.PaymentReceipt.findByPk(receiptId);
    if (!receipt) throw Object.assign(new Error('Receipt not found'), { status: 404, code: 'RECEIPT_NOT_FOUND' });
    if (receipt.status !== 'ACTIVE') throw Object.assign(new Error('Only active receipts can be sent'), { status: 409, code: 'RECEIPT_NOT_ACTIVE' });
    if (!receipt.pdfStorageKey) throw Object.assign(new Error('Receipt PDF is not ready'), { status: 409, code: 'RECEIPT_PDF_PENDING' });
    return { receipt, ...(await this.resolveContext(receipt, preferred)) };
  }

  async send(receiptId, { manual = false, actorUserId = null, conversationId = null, whatsappAccountId = null } = {}) {
    const receipt = await this.PaymentReceipt.findByPk(receiptId);
    if (!receipt) throw Object.assign(new Error('Receipt not found'), { status: 404, code: 'RECEIPT_NOT_FOUND' });
    if (!manual && receipt.whatsappSentAt) return { receipt, skipped: true, reason: 'already_sent' };
    const { student, conversation } = await this.preflight(receiptId, { conversationId, whatsappAccountId });

    const filePath = this.receiptStorageService.resolveKey(receipt.pdfStorageKey);
    const uploaded = await this.whatsappService.uploadMedia({ filePath, mimeType: 'application/pdf', whatsappAccountId: conversation.whatsappAccountId });
    const phone = student.phone || receipt.studentPhoneSnapshot;
    const prepared = await this.outboundHistoryService.prepare({
      phone, contactId: student.contactId, conversationId: conversation.id,
      whatsappAccountId: conversation.whatsappAccountId,
      sentByUserId: actorUserId, type: 'document', messageType: 'payment_receipt',
      text: caption(receipt), mediaId: uploaded.id, status: 'pending',
      rawPayload: { source: 'payment_receipt', paymentReceiptId: receipt.id }
    });
    let response;
    try {
      response = await this.whatsappService.sendMediaMessage({
        to: phone, mediaType: 'document', mediaId: uploaded.id,
        filename: `${receipt.receiptNumber}.pdf`, caption: caption(receipt),
        whatsappAccountId: conversation.whatsappAccountId
      });
    } catch (error) {
      await this.outboundHistoryService.fail(prepared, error).catch(() => null);
      throw error;
    }
    const messageId = response?.messages?.[0]?.id || response?.id || null;
    await this.outboundHistoryService.complete(prepared, {
      whatsappMessageId: messageId, status: 'sent',
      rawPayload: { source: 'payment_receipt', paymentReceiptId: receipt.id }
    });
    await receipt.update({
      whatsappSentAt: new Date(), whatsappMessageId: messageId,
      conversationId: conversation.id, whatsappAccountId: conversation.whatsappAccountId
    });
    await this.auditService.record({
      userId: actorUserId,
      action: manual ? 'PAYMENT_RECEIPT_WHATSAPP_RESENT' : 'PAYMENT_RECEIPT_WHATSAPP_SENT',
      entityType: 'payment_receipt', entityId: receipt.id,
      changes: { receiptNumber: receipt.receiptNumber, whatsappMessageId: messageId, manual }
    });
    return { receipt, response, skipped: false };
  }
}

module.exports = new PaymentReceiptDeliveryService();
module.exports.caption = caption;
module.exports.createPaymentReceiptDeliveryService = (dependencies) => new PaymentReceiptDeliveryService(dependencies);
