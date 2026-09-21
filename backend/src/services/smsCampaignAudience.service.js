const { Op } = require('sequelize');
const { sequelize, Contact, Lead, LeadStatus, Student, Course, Batch, User } = require('../models');
const { normalizeSriLankanPhone } = require('../utils/phone');

const RECIPIENT_SOURCES = ['contacts', 'leads', 'students', 'course', 'batch', 'manual'];
const MAX_CANDIDATES = 20000;

function fullName(person) {
  return [person?.firstName, person?.lastName].filter(Boolean).join(' ') || person?.name || null;
}

function tagFilterClause(model, tag) {
  // Same JSONB "does this array contain this value" pattern already used
  // by the WhatsApp campaign audience builder (campaign.service.js).
  return sequelize.literal(`"${model}"."tags"::jsonb ? ${sequelize.escape(tag)}`);
}

// Splits a pasted block of numbers on newlines or commas — the two
// separators the task explicitly calls out ("one per line or comma
// separated").
function splitManualNumbers(raw) {
  return String(raw || '')
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

class SmsCampaignAudienceService {
  // Resolves a recipient source + its filters into a deduplicated,
  // phone-normalized candidate list, without ever writing anything —
  // sms_campaign_recipients rows are only created when the caller decides
  // to persist this result (see smsCampaign.service.js's prepareRecipients).
  async resolve({ recipientSource, audienceConfig = {} }) {
    if (!RECIPIENT_SOURCES.includes(recipientSource)) {
      throw Object.assign(new Error(`Unknown recipient source "${recipientSource}".`), { status: 422, code: 'VALIDATION_FAILED' });
    }

    const byPhone = new Map();
    const invalid = [];

    const addCandidate = ({ rawPhone, name, contactId, leadId, studentId, entityType, entityId }) => {
      const canonical = normalizeSriLankanPhone(rawPhone);
      if (!canonical) {
        invalid.push({ source: entityType, entityId: entityId ?? null, rawPhone: rawPhone ?? null });
        return;
      }
      const existing = byPhone.get(canonical);
      if (existing) {
        existing.matchedEntities.push({ type: entityType, id: entityId ?? null });
        if (!existing.contactId && contactId) existing.contactId = contactId;
        if (!existing.leadId && leadId) existing.leadId = leadId;
        if (!existing.studentId && studentId) existing.studentId = studentId;
        if (!existing.name && name) existing.name = name;
      } else {
        byPhone.set(canonical, {
          phone: canonical,
          name: name || null,
          contactId: contactId || null,
          leadId: leadId || null,
          studentId: studentId || null,
          matchedEntities: [{ type: entityType, id: entityId ?? null }]
        });
      }
    };

    if (recipientSource === 'contacts') {
      const where = {};
      if (audienceConfig.status) where.status = audienceConfig.status;
      const andClauses = [];
      if (audienceConfig.tag) andClauses.push(tagFilterClause('Contact', audienceConfig.tag));
      if (andClauses.length) where[Op.and] = andClauses;
      const contacts = await Contact.findAll({ where, limit: MAX_CANDIDATES, order: [['created_at', 'DESC']] });
      contacts.forEach((contact) => addCandidate({
        rawPhone: contact.phone, name: fullName(contact) || contact.phone,
        contactId: contact.id, entityType: 'contact', entityId: contact.id
      }));
    } else if (recipientSource === 'leads') {
      const where = {};
      if (audienceConfig.leadStatusId) where.statusId = Number(audienceConfig.leadStatusId);
      if (audienceConfig.assignedAgentId) where.ownerId = Number(audienceConfig.assignedAgentId);
      const contactWhere = {};
      const contactAnd = [];
      if (audienceConfig.tag) contactAnd.push(tagFilterClause('contact', audienceConfig.tag));
      if (contactAnd.length) contactWhere[Op.and] = contactAnd;
      const leads = await Lead.findAll({
        where,
        include: [
          { model: Contact, as: 'contact', required: true, where: Object.keys(contactWhere).length ? contactWhere : undefined },
          { model: LeadStatus, as: 'status', required: false },
          { model: User, as: 'owner', attributes: ['id', 'firstName', 'lastName'], required: false }
        ],
        limit: MAX_CANDIDATES, order: [['created_at', 'DESC']]
      });
      leads.forEach((lead) => addCandidate({
        rawPhone: lead.contact?.phone, name: fullName(lead.contact) || lead.contact?.phone,
        contactId: lead.contact?.id, leadId: lead.id, entityType: 'lead', entityId: lead.id
      }));
    } else if (recipientSource === 'students' || recipientSource === 'course' || recipientSource === 'batch') {
      const where = {};
      if (recipientSource === 'course') {
        if (!audienceConfig.courseId) throw Object.assign(new Error('A course must be selected.'), { status: 422, code: 'VALIDATION_FAILED' });
        where.courseId = Number(audienceConfig.courseId);
      } else if (recipientSource === 'batch') {
        if (!audienceConfig.batchId) throw Object.assign(new Error('A batch must be selected.'), { status: 422, code: 'VALIDATION_FAILED' });
        where.batchId = Number(audienceConfig.batchId);
      } else {
        if (audienceConfig.courseId) where.courseId = Number(audienceConfig.courseId);
        if (audienceConfig.batchId) where.batchId = Number(audienceConfig.batchId);
        if (audienceConfig.status) where.status = audienceConfig.status;
      }
      const students = await Student.findAll({ where, limit: MAX_CANDIDATES, order: [['created_at', 'DESC']] });
      students.forEach((student) => addCandidate({
        rawPhone: student.phone, name: student.name,
        contactId: student.contactId, leadId: student.leadId, studentId: student.id,
        entityType: 'student', entityId: student.id
      }));
    } else if (recipientSource === 'manual') {
      const numbers = Array.isArray(audienceConfig.phoneNumbers)
        ? audienceConfig.phoneNumbers
        : splitManualNumbers(audienceConfig.phoneNumbers);
      numbers.forEach((rawPhone, index) => addCandidate({ rawPhone, name: null, entityType: 'manual', entityId: index }));
    }

    const recipients = Array.from(byPhone.values());
    return {
      recipients,
      invalid,
      totalValid: recipients.length,
      totalInvalid: invalid.length,
      duplicatesRemoved: recipients.reduce((sum, r) => sum + Math.max(r.matchedEntities.length - 1, 0), 0)
    };
  }

  async audienceOptions() {
    const [leadStatuses, courses, batches] = await Promise.all([
      LeadStatus.findAll({ where: { active: true }, attributes: ['id', 'name'], order: [['display_order', 'ASC']] }),
      Course.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
      Batch.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] })
    ]);
    return { leadStatuses, courses, batches, contactStatuses: ['new', 'active', 'inactive', 'archived'], studentStatuses: ['enrolled', 'active', 'completed', 'dropped', 'suspended'] };
  }
}

module.exports = new SmsCampaignAudienceService();
module.exports.RECIPIENT_SOURCES = RECIPIENT_SOURCES;
