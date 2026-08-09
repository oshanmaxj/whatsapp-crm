const { Op } = require('sequelize');
const { Contact, Conversation, Lead, Student } = require('../models');
const auditService = require('./audit.service');
const logger = require('../config/logger');
const socketService = require('./socket.service');
const { normalizePhone } = require('../utils/phone');

const PLACEHOLDERS = new Set(['unnamed', 'unknown', 'recipient', 'student']);

function normalizeStudentName(value) {
  const name = String(value || '').trim().replace(/\s+/gu, ' ');
  if (!name || PLACEHOLDERS.has(name.toLocaleLowerCase()) || /^\+?[\d\s().-]+$/u.test(name)) {
    throw Object.assign(new Error('A valid registered student name is required.'), {
      status: 400, code: 'STUDENT_CANONICAL_NAME_INVALID'
    });
  }
  return name;
}

function contactDisplayName(contact) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
}

function splitName(name) {
  const [firstName, ...rest] = name.split(' ');
  return { firstName, lastName: rest.join(' ') || null };
}

class StudentCanonicalIdentityService {
  async resolveContact({ student, contactId, leadId, conversationId, whatsappAccountId, transaction }) {
    const explicitId = contactId || student?.contactId;
    if (explicitId) return Contact.findByPk(explicitId, { transaction, lock: transaction?.LOCK?.UPDATE });

    if (leadId || student?.leadId) {
      const lead = await Lead.findByPk(leadId || student.leadId, { attributes: ['id', 'contactId', 'whatsappAccountId'], transaction });
      if (lead?.contactId) return Contact.findByPk(lead.contactId, { transaction, lock: transaction?.LOCK?.UPDATE });
    }
    if (conversationId) {
      const conversation = await Conversation.findByPk(conversationId, { attributes: ['id', 'contactId', 'whatsappAccountId'], transaction });
      if (conversation?.contactId) return Contact.findByPk(conversation.contactId, { transaction, lock: transaction?.LOCK?.UPDATE });
    }

    const normalizedPhone = normalizePhone(student?.phone);
    if (!normalizedPhone) return null;
    const where = {
      [Op.or]: [{ normalizedPhone }, { phone: normalizedPhone }, { whatsappId: normalizedPhone }],
      ...(whatsappAccountId ? { whatsappAccountId } : {})
    };
    const candidates = await Contact.findAll({ where, limit: 2, transaction, lock: transaction?.LOCK?.UPDATE });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      logger.warn('STUDENT_CONTACT_IDENTITY_AMBIGUOUS', {
        studentId: student?.id || null,
        contactIds: candidates.map((row) => row.id),
        whatsappAccountId: whatsappAccountId || null
      });
      return { ambiguous: true, candidateIds: candidates.map((row) => row.id) };
    }
    return null;
  }

  async sync({ studentId, contactId, leadId, conversationId, whatsappAccountId, source = 'student_registration', actorUserId = null, transaction }) {
    const student = await Student.findByPk(studentId, { transaction, lock: transaction?.LOCK?.UPDATE });
    if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });
    const name = normalizeStudentName(student.name);
    const contact = await this.resolveContact({ student, contactId, leadId, conversationId, whatsappAccountId, transaction });
    if (contact?.ambiguous) return { synchronized: false, reviewRequired: true, candidateIds: contact.candidateIds };
    if (!contact) return { synchronized: false, reviewRequired: true, reason: 'contact_not_found' };

    const previousName = contactDisplayName(contact);
    const nameValues = splitName(name);
    await contact.update({ ...nameValues, ...(student.email && !contact.email ? { email: student.email } : {}) }, { transaction });
    if (String(student.contactId || '') !== String(contact.id)) await student.update({ contactId: contact.id }, { transaction });

    let lead = leadId || student.leadId ? await Lead.findByPk(leadId || student.leadId, { transaction }) : null;
    if (lead && String(lead.contactId) !== String(contact.id)) {
      logger.warn('STUDENT_CONTACT_IDENTITY_AMBIGUOUS', { studentId: student.id, contactId: contact.id, leadId: lead.id });
      lead = null;
    }
    const conversation = conversationId
      ? await Conversation.findOne({ where: { id: conversationId, contactId: contact.id }, transaction })
      : await Conversation.findOne({ where: { contactId: contact.id, ...(whatsappAccountId ? { whatsappAccountId } : {}) }, order: [['last_message_at', 'DESC'], ['id', 'DESC']], transaction });

    if (previousName !== name) await auditService.record({
      userId: actorUserId, action: 'STUDENT_CANONICAL_CONTACT_NAME_SYNCED', entityType: 'student', entityId: student.id,
      changes: { studentId: student.id, contactId: contact.id, leadId: lead?.id || null, conversationId: conversation?.id || null, whatsappAccountId: conversation?.whatsappAccountId || whatsappAccountId || null, source, previousName, newName: name },
      transaction, required: true
    });
    return { synchronized: true, reviewRequired: false, studentId: student.id, contactId: contact.id, leadId: lead?.id || null, conversationId: conversation?.id || null, whatsappAccountId: conversation?.whatsappAccountId || whatsappAccountId || null, displayName: name };
  }

  async publish(result) {
    if (!result?.synchronized || !result.conversationId) return;
    await socketService.emitToConversationAudience(result.conversationId, 'student.identity.updated', {
      studentId: result.studentId, contactId: result.contactId, leadId: result.leadId,
      conversationId: result.conversationId, displayName: result.displayName
    });
  }

  async publishStudentChanged(studentId, event = 'student.enrollment.updated') {
    const student = await Student.findByPk(studentId, { attributes: ['id', 'contactId'] });
    if (!student?.contactId) return;
    const conversations = await Conversation.findAll({ where: { contactId: student.contactId }, attributes: ['id'] });
    await Promise.all(conversations.map((conversation) => socketService.emitToConversationAudience(conversation.id, event, {
      studentId: student.id, contactId: student.contactId, conversationId: conversation.id
    })));
  }
}

module.exports = new StudentCanonicalIdentityService();
module.exports.normalizeStudentName = normalizeStudentName;
