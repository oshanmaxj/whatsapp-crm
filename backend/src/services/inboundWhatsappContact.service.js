const { Op } = require('sequelize');
const models = require('../models');
const logger = require('../config/logger');
const { requireNormalizedPhone } = require('../utils/phone');

function lastFour(value) {
  const text = String(value || '');
  return text ? text.slice(-4) : null;
}

function splitName(profileName) {
  const parts = String(profileName || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || 'WhatsApp', lastName: parts.join(' ') || null };
}

function createInboundWhatsappContactService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  const Contact = dependencies.Contact || models.Contact;
  const Conversation = dependencies.Conversation || models.Conversation;
  const Notification = dependencies.Notification || models.Notification;
  const log = dependencies.logger || logger;

  async function lockIdentities(whatsappAccountId, whatsappId, normalizedPhone, transaction) {
    if (sequelize.getDialect() !== 'postgres') return;
    const keys = [
      `wa-contact:${whatsappId}`,
      `phone-contact:${normalizedPhone}`,
      `account-phone:${whatsappAccountId || 'default'}:${normalizedPhone}`
    ].sort();
    for (const identity of keys) {
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:identity))', {
        replacements: { identity }, transaction
      });
    }
  }

  async function findOne(where, transaction) {
    return Contact.findOne({
      where,
      paranoid: false,
      transaction,
      ...(transaction?.LOCK?.UPDATE ? { lock: transaction.LOCK.UPDATE } : {})
    });
  }

  async function resolveInboundWhatsAppContact({
    whatsappAccountId = null,
    whatsappId,
    normalizedPhone,
    profileName,
    transaction
  }) {
    if (!transaction) throw new Error('Inbound WhatsApp contact resolution requires a transaction');
    const canonicalPhone = requireNormalizedPhone(normalizedPhone || whatsappId);
    const canonicalWhatsappId = requireNormalizedPhone(whatsappId || normalizedPhone);
    await lockIdentities(whatsappAccountId, canonicalWhatsappId, canonicalPhone, transaction);

    const whatsappOwner = await findOne({ whatsappId: canonicalWhatsappId }, transaction);
    const phoneContact = await findOne({
      [Op.or]: [{ normalizedPhone: canonicalPhone }, { phone: canonicalPhone }]
    }, transaction);
    const conversation = await Conversation.findOne({
      where: { normalizedPhone: canonicalPhone, whatsappAccountId },
      transaction,
      ...(transaction?.LOCK?.UPDATE ? { lock: transaction.LOCK.UPDATE } : {}),
      order: [['created_at', 'ASC']]
    });
    const conversationContact = conversation?.contactId
      ? await Contact.findByPk(conversation.contactId, {
          paranoid: false,
          transaction,
          ...(transaction?.LOCK?.UPDATE ? { lock: transaction.LOCK.UPDATE } : {})
        })
      : null;

    let contact = whatsappOwner || phoneContact || conversationContact;
    let strategy = whatsappOwner
      ? 'whatsapp_id'
      : phoneContact
        ? 'normalized_phone'
        : conversationContact
          ? 'conversation_account'
          : 'created';
    const conflict = Boolean(whatsappOwner && phoneContact && whatsappOwner.id !== phoneContact.id);
    const name = splitName(profileName);

    if (!contact) {
      contact = await Contact.create({
        phone: canonicalPhone,
        normalizedPhone: canonicalPhone,
        whatsappId: canonicalWhatsappId,
        firstName: name.firstName,
        lastName: name.lastName,
        status: 'new',
        whatsappAccountId
      }, { transaction });
    } else {
      if (contact.deletedAt) await contact.restore({ transaction });
      const updates = {};
      // The WhatsApp owner is canonical during a duplicate conflict. Do not
      // move its phone identity or steal the unique WhatsApp ID from it.
      if (!conflict) {
        if (!contact.normalizedPhone) updates.normalizedPhone = canonicalPhone;
        if (!contact.phone) updates.phone = canonicalPhone;
      }
      if (!contact.whatsappId) updates.whatsappId = canonicalWhatsappId;
      if (!contact.firstName && name.firstName) updates.firstName = name.firstName;
      if (!contact.lastName && name.lastName) updates.lastName = name.lastName;
      if (!contact.whatsappAccountId && whatsappAccountId) updates.whatsappAccountId = whatsappAccountId;
      if (Object.keys(updates).length) await contact.update(updates, { transaction });
    }

    const resolution = {
      contact,
      strategy,
      conflict,
      whatsappOwnerContactId: whatsappOwner?.id || null,
      phoneContactId: phoneContact?.id || null,
      conversationContactId: conversationContact?.id || null,
      whatsappIdLastFour: lastFour(canonicalWhatsappId)
    };
    log.info('whatsapp_inbound_contact_resolved', {
      contactId: contact.id,
      whatsappAccountId,
      whatsappIdLastFour: resolution.whatsappIdLastFour,
      strategy,
      conflictDetected: conflict,
      whatsappOwnerContactId: resolution.whatsappOwnerContactId,
      phoneContactId: resolution.phoneContactId,
      conversationContactId: resolution.conversationContactId
    });
    return resolution;
  }

  async function recordConflict(resolution, whatsappAccountId = null) {
    if (!resolution?.conflict) return null;
    const metadata = {
      whatsappAccountId,
      canonicalContactId: resolution.contact.id,
      whatsappOwnerContactId: resolution.whatsappOwnerContactId,
      phoneContactId: resolution.phoneContactId,
      whatsappIdLastFour: resolution.whatsappIdLastFour
    };
    log.warn('whatsapp_inbound_contact_conflict', metadata);
    return Notification.create({
      type: 'whatsapp_contact_identity_conflict',
      title: 'Duplicate WhatsApp contact identity detected',
      message: `WhatsApp contact ${resolution.contact.id} was selected as canonical; review duplicate contact ${resolution.phoneContactId}.`,
      data: metadata
    }).catch((error) => {
      log.warn('whatsapp_contact_conflict_notification_failed', { ...metadata, message: error.message });
      return null;
    });
  }

  return { resolveInboundWhatsAppContact, recordConflict };
}

module.exports = createInboundWhatsappContactService();
module.exports.createInboundWhatsappContactService = createInboundWhatsappContactService;
