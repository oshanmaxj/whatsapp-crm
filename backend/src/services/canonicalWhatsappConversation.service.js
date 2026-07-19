const { Op } = require('sequelize');
const models = require('../models');
const { normalizePhone } = require('../utils/phone');
const logger = require('../config/logger');

function fail(message, code = 'WHATSAPP_CONVERSATION_INVALID', status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function createCanonicalWhatsappConversationService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  const Conversation = dependencies.Conversation || models.Conversation;
  const Message = dependencies.Message || models.Message;
  const PaymentSlip = dependencies.PaymentSlip || models.PaymentSlip;
  const Contact = dependencies.Contact || models.Contact;

  async function validate(conversation, contactId, whatsappAccountId) {
    if (!conversation) return null;
    if (conversation.status === 'archived') throw fail('Archived conversations cannot be used for outbound WhatsApp delivery.', 'WHATSAPP_CONVERSATION_ARCHIVED');
    if (contactId && String(conversation.contactId) !== String(contactId)) throw fail('Conversation contact does not match the intended contact.');
    if (whatsappAccountId && String(conversation.whatsappAccountId) !== String(whatsappAccountId)) throw fail('Conversation WhatsApp account does not match the selected account.');
    if (!conversation.whatsappAccountId) throw fail('Canonical WhatsApp conversation has no WhatsApp account.', 'WHATSAPP_ACCOUNT_REQUIRED');
    return conversation;
  }

  function logResolved(conversation, strategy) {
    logger.info('canonical_whatsapp_conversation_resolved', {
      conversationId: conversation.id, contactId: conversation.contactId,
      whatsappAccountId: conversation.whatsappAccountId, strategy,
      phoneLast4: String(conversation.normalizedPhone || '').slice(-4)
    });
    return conversation;
  }

  async function resolve(input, transaction) {
    let contactId = input.contactId || null;
    let whatsappAccountId = input.whatsappAccountId || null;
    const preferredIds = [{ id: input.preferredConversationId, strategy: 'preferred_conversation' }];
    if (input.sourceMessageId) {
      const source = await Message.findByPk(input.sourceMessageId, { transaction });
      if (source?.conversationId) preferredIds.push({ id: source.conversationId, strategy: 'source_message' });
      contactId ||= source?.contactId || null;
      whatsappAccountId ||= source?.whatsappAccountId || null;
    }
    if (input.paymentSlipId) {
      const slip = await PaymentSlip.findByPk(input.paymentSlipId, { transaction });
      if (slip?.conversationId) preferredIds.push({ id: slip.conversationId, strategy: 'payment_slip' });
      contactId ||= slip?.contactId || null;
      whatsappAccountId ||= slip?.whatsappAccountId || null;
    }
    for (const preferred of preferredIds.filter((item) => item.id)) {
      const candidate = await Conversation.findByPk(preferred.id, { transaction });
      if (!candidate) continue;
      if (candidate.status === 'archived') continue;
      contactId ||= candidate.contactId;
      whatsappAccountId ||= candidate.whatsappAccountId;
      return logResolved(await validate(candidate, contactId, whatsappAccountId), preferred.strategy);
    }
    if (!contactId) throw fail('A contact is required to resolve a WhatsApp conversation.', 'WHATSAPP_CONTACT_REQUIRED', 422);
    if (!whatsappAccountId) {
      const accounts = await Conversation.findAll({
        where: { contactId, whatsappAccountId: { [Op.ne]: null }, status: { [Op.in]: ['open', 'pending'] } },
        attributes: ['whatsappAccountId'], transaction, raw: true
      });
      const ids = [...new Set(accounts.map((row) => String(row.whatsappAccountId)).filter(Boolean))];
      if (ids.length === 1) [whatsappAccountId] = ids;
      else throw fail('WhatsApp account is required because this contact does not have one unambiguous active account.', 'WHATSAPP_ACCOUNT_AMBIGUOUS');
    }
    if (sequelize.getDialect?.() === 'postgres') {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:identity))', {
        replacements: { identity: `canonical-whatsapp:${contactId}:${whatsappAccountId}` }, transaction
      });
    }
    let strategy = 'active_contact_account';
    let conversation = await Conversation.findOne({
      where: { contactId, whatsappAccountId, status: { [Op.in]: ['open', 'pending'] } },
      order: [['last_message_at', 'DESC'], ['updated_at', 'DESC'], ['id', 'ASC']], transaction,
      lock: transaction?.LOCK?.UPDATE
    });
    if (!conversation) {
      strategy = 'recent_contact_account';
      conversation = await Conversation.findOne({
        where: { contactId, whatsappAccountId },
        order: [['last_message_at', 'DESC'], ['updated_at', 'DESC']], transaction, lock: transaction?.LOCK?.UPDATE
      });
      if (['closed', 'archived'].includes(conversation?.status)) await conversation.update({ status: 'open' }, { transaction });
    }
    if (!conversation) {
      strategy = 'created';
      const contact = await Contact.findByPk(contactId, { transaction });
      if (!contact) throw fail('Contact not found for WhatsApp conversation.', 'WHATSAPP_CONTACT_NOT_FOUND', 404);
      const normalizedPhone = normalizePhone(contact.whatsappId || contact.phone);
      conversation = await Conversation.create({
        contactId, whatsappAccountId, normalizedPhone,
        whatsappThreadId: `${whatsappAccountId}:${normalizedPhone}`,
        status: 'open', lastMessageAt: new Date()
      }, { transaction });
    }
    const resolved = await validate(conversation, contactId, whatsappAccountId);
    return logResolved(resolved, strategy);
  }

  return {
    async resolveCanonicalWhatsAppConversation(input) {
      if (input.transaction) return resolve(input, input.transaction);
      return sequelize.transaction((transaction) => resolve(input, transaction));
    }
  };
}

const service = createCanonicalWhatsappConversationService();
module.exports = service;
module.exports.createCanonicalWhatsappConversationService = createCanonicalWhatsappConversationService;
