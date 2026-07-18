const { Op, UniqueConstraintError } = require('sequelize');
const models = require('../models');
const logger = require('../config/logger');
const socketService = require('./socket.service');
const inboundWhatsappContactService = require('./inboundWhatsappContact.service');
const { normalizePhone, requireNormalizedPhone } = require('../utils/phone');

function createConversationIdentityService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  const Contact = dependencies.Contact || models.Contact;
  const Conversation = dependencies.Conversation || models.Conversation;
  const sockets = dependencies.socketService || socketService;
  const log = dependencies.logger || logger;
  const inboundContactResolver = dependencies.inboundWhatsappContactService || inboundWhatsappContactService;

  function isUniqueViolation(error) {
    return error instanceof UniqueConstraintError
      || error?.name === 'SequelizeUniqueConstraintError'
      || error?.original?.code === '23505'
      || error?.parent?.code === '23505';
  }

  async function lockIdentity(normalizedPhone, whatsappAccountId, transaction) {
    if (sequelize.getDialect() !== 'postgres') return;
    const identity = `${whatsappAccountId || 'default'}:${normalizedPhone}`;
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:contactIdentity))', {
      replacements: { contactIdentity: `contact:${normalizedPhone}` }, transaction
    });
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:identity))', {
      replacements: { identity }, transaction
    });
  }

  async function findContact(normalizedPhone, transaction) {
    const rows = await Contact.findAll({
      where: {
        [Op.or]: [
          { normalizedPhone },
          { phone: normalizedPhone },
          { whatsappId: normalizedPhone }
        ]
      },
      paranoid: false,
      transaction,
      order: [['deleted_at', 'ASC NULLS FIRST'], ['created_at', 'ASC']],
      limit: 20
    });
    return rows.find((row) => (
      row.normalizedPhone === normalizedPhone
      || normalizePhone(row.phone || row.whatsappId) === normalizedPhone
    )) || null;
  }

  async function run(values, transaction) {
    const normalizedPhone = requireNormalizedPhone(values.phone || values.whatsappId);
    const whatsappAccountId = values.whatsappAccountId || null;
    let contactResolution = null;
    let contact = null;
    if (values.whatsappId) {
      contactResolution = await inboundContactResolver.resolveInboundWhatsAppContact({
        whatsappAccountId,
        whatsappId: values.whatsappId,
        normalizedPhone,
        profileName: values.name || values.firstName,
        transaction
      });
      contact = contactResolution.contact;
    } else {
      await lockIdentity(normalizedPhone, whatsappAccountId, transaction);
      contact = values.contactId
        ? await Contact.findByPk(values.contactId, { transaction, paranoid: false })
        : null;
      if (!contact) contact = await findContact(normalizedPhone, transaction);
      if (contact?.deletedAt) await contact.restore({ transaction });
    }
    if (!contact) {
      const parts = String(values.name || values.firstName || '').trim().split(/\s+/).filter(Boolean);
      contact = await Contact.create({
        phone: normalizedPhone,
        normalizedPhone,
        whatsappId: values.whatsappId ? normalizedPhone : null,
        firstName: values.firstName || parts.shift() || 'WhatsApp',
        lastName: values.lastName || parts.join(' ') || null,
        status: values.contactStatus || 'active',
        whatsappAccountId
      }, { transaction });
    } else if (!values.whatsappId) {
      const updates = {};
      if (contact.normalizedPhone !== normalizedPhone) updates.normalizedPhone = normalizedPhone;
      if (values.whatsappId && !contact.whatsappId) updates.whatsappId = normalizedPhone;
      if (values.firstName && !contact.firstName) updates.firstName = values.firstName;
      if (values.lastName && !contact.lastName) updates.lastName = values.lastName;
      if (whatsappAccountId && !contact.whatsappAccountId) updates.whatsappAccountId = whatsappAccountId;
      if (Object.keys(updates).length) await contact.update(updates, { transaction });
    }

    let conversation = await Conversation.findOne({
      where: { normalizedPhone, whatsappAccountId },
      transaction,
      lock: transaction.LOCK.UPDATE,
      order: [
        [sequelize.literal("CASE WHEN status = 'open' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END"), 'ASC'],
        ['created_at', 'ASC']
      ]
    });
    if (!conversation && values.whatsappThreadId) {
      conversation = await Conversation.findOne({
        where: { whatsappThreadId: values.whatsappThreadId }, transaction, lock: transaction.LOCK.UPDATE
      });
    }

    if (conversation) {
      const updates = {
        normalizedPhone,
        contactId: contact.id,
        leadId: conversation.leadId || values.leadId || null,
        assignedUserId: values.assignedTo ?? conversation.assignedUserId,
        lastMessageAt: values.lastMessageAt || conversation.lastMessageAt,
        whatsappAccountId
      };
      if (!conversation.whatsappThreadId && values.whatsappThreadId) updates.whatsappThreadId = values.whatsappThreadId;
      await conversation.update(updates, { transaction });
      const persisted = typeof values.afterResolve === 'function'
        ? await values.afterResolve({ contact, conversation, transaction })
        : null;
      return { contact, conversation, created: false, normalizedPhone, contactResolution, persisted };
    }

    conversation = await Conversation.create({
      contactId: contact.id,
      normalizedPhone,
      leadId: values.leadId || null,
      whatsappThreadId: values.whatsappThreadId || `${whatsappAccountId || 'default'}:${normalizedPhone}`,
      assignedUserId: values.assignedTo || null,
      lastMessageAt: values.lastMessageAt || new Date(),
      whatsappAccountId,
      status: 'open'
    }, { transaction });
    const persisted = typeof values.afterResolve === 'function'
      ? await values.afterResolve({ contact, conversation, transaction })
      : null;
    return { contact, conversation, created: true, normalizedPhone, contactResolution, persisted };
  }

  return {
    async findOrCreateByPhoneAndAccount(values, options = {}) {
      if (options.transaction) return run(values, options.transaction);
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const result = await sequelize.transaction((transaction) => run(values, transaction));
          await inboundContactResolver.recordConflict(result.contactResolution, values.whatsappAccountId || null);
          return result;
        } catch (error) {
          lastError = error;
          if (!isUniqueViolation(error) || attempt === 2) {
            log.error('whatsapp_identity_transaction_failed', {
              attempt,
              whatsappIdLastFour: String(values.whatsappId || values.phone || '').slice(-4) || null,
              postgresCode: error.original?.code || error.parent?.code || error.code || null,
              constraint: error.original?.constraint || error.parent?.constraint || null,
              message: error.message
            });
            throw error;
          }
          log.warn('whatsapp_identity_transaction_retry', {
            attempt,
            postgresCode: error.original?.code || error.parent?.code || null,
            constraint: error.original?.constraint || error.parent?.constraint || null
          });
        }
      }
      throw lastError;
    },
    emitMerged(payload) {
      log.info('conversation_merged', payload);
      sockets.emit('conversation.merged', payload);
    }
  };
}

module.exports = createConversationIdentityService();
module.exports.createConversationIdentityService = createConversationIdentityService;
