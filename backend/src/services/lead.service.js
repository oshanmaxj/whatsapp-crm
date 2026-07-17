const { Op, fn, col } = require('sequelize');
const { sequelize, Contact, Conversation, Lead, LeadAssignment, LeadStatus, LeadSource, User, LeadActivity } = require('../models');
const assignmentService = require('./assignment.service');
const leadAssignmentService = require('./leadAssignment.service');
const leadStatusService = require('./leadStatus.service');
const { LEAD_STATUSES, normalizeLeadStatusCode } = require('../constants/leadStatuses');
const { normalizeSriLankanPhone, requireNormalizedPhone } = require('../utils/phone');

const DEFAULT_SOURCES = ['Facebook Ads', 'WhatsApp Ads', 'Website', 'Instagram', 'TikTok', 'Google Search', 'Referral', 'Organic', 'Manual Entry'];

function splitName(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || null,
    lastName: parts.slice(1).join(' ') || null
  };
}

function normalizeStatus(name) {
  if (!name) return 'New';
  const code = normalizeLeadStatusCode(name);
  const found = LEAD_STATUSES.find((status) => status.code === code)?.name;
  return found || name;
}

function colomboDateRange(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return null;
  const valid = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if ((dateFrom && !valid(dateFrom)) || (dateTo && !valid(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) {
    throw Object.assign(new Error('The selected date range is invalid.'), { status: 422, code: 'INVALID_DATE_RANGE' });
  }
  const range = {};
  if (dateFrom) range[Op.gte] = new Date(`${dateFrom}T00:00:00+05:30`);
  if (dateTo) {
    const end = new Date(`${dateTo}T00:00:00+05:30`);
    end.setUTCDate(end.getUTCDate() + 1);
    range[Op.lt] = end;
  }
  return range;
}

function normalizeSource(name) {
  if (!name) return 'Manual Entry';
  const normalized = String(name).trim().toLowerCase();
  const found = DEFAULT_SOURCES.find((source) => source.toLowerCase() === normalized);
  return found || name;
}

function normalizeLeadStatusPayload(payload = {}) {
  const leadStatusPayload = payload.leadStatus && typeof payload.leadStatus === 'object' ? payload.leadStatus : {};
  let statusCode = payload.statusCode ?? payload.status ?? leadStatusPayload.statusCode
    ?? leadStatusPayload.code ?? payload.leadStatus ?? payload.code;
  let statusId = payload.statusId ?? leadStatusPayload.id;
  if ((statusCode === undefined || statusCode === null || String(statusCode).trim() === '')
    && statusId !== undefined && statusId !== null && !/^\d+$/.test(String(statusId).trim())) {
    statusCode = statusId;
    statusId = undefined;
  }
  return { statusCode, statusId, expectedCurrentStatusCode: payload.expectedCurrentStatusCode };
}

function serializeAgent(agent) {
  if (!agent) return null;
  return {
    id: agent.id,
    firstName: agent.firstName,
    lastName: agent.lastName,
    name: [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email,
    email: agent.email
  };
}

function serializeLead(lead) {
  return {
    id: lead.id,
    name: lead.contact ? [lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(' ') : null,
    phone: lead.contact?.phone || null,
    email: lead.contact?.email || null,
    contact: lead.contact
      ? {
          id: lead.contact.id,
          firstName: lead.contact.firstName,
          lastName: lead.contact.lastName,
          phone: lead.contact.phone,
          email: lead.contact.email,
          company: lead.contact.company
        }
      : null,
    source: lead.source?.name || null,
    status: lead.status?.name || null,
    statusCode: lead.status?.code || normalizeLeadStatusCode(lead.stage),
    priority: lead.priority,
    assignedAgent: serializeAgent(lead.owner),
    courseInterested: lead.courseInterested,
    batchInterested: lead.batchInterested,
    budget: lead.budget,
    studentType: lead.studentType,
    notes: lead.notes,
    followUpDate: lead.nextFollowupAt,
    stage: lead.stage,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    convertedAt: lead.convertedAt || null,
    conversationId: lead.getDataValue ? (lead.getDataValue('resolvedConversationId') || null) : (lead.resolvedConversationId || null),
    whatsappAccountId: lead.whatsappAccountId || null,
    assignmentHistory: lead.assignments
      ? lead.assignments.map((assignment) => ({
          id: assignment.id,
          assignedAt: assignment.assigned_at || assignment.assignedAt,
          note: assignment.note,
          assignee: serializeAgent(assignment.assignee),
          assigner: serializeAgent(assignment.assigner)
        }))
      : undefined
  };
}

class LeadService {
  async getStatusByName(name) {
    const definition = LEAD_STATUSES.find((item) => item.code === normalizeLeadStatusCode(name));
    if (!definition) return null;
    return LeadStatus.findOne({ where: { code: definition.code } });
  }

  async getSourceByName(name) {
    return LeadSource.findOne({ where: { name: normalizeSource(name) } });
  }

  async ensureStatus(name) {
    const statusName = normalizeStatus(name);
    const definition = LEAD_STATUSES.find((item) => item.name === statusName);
    if (!definition) throw Object.assign(new Error('Lead status is invalid.'), { status: 422, code: 'INVALID_LEAD_STATUS' });
    const status = await LeadStatus.findOne({ where: { code: definition.code, active: true } });
    if (!status) throw Object.assign(new Error('Unified lead statuses are not initialized. Run migrations or restart the backend.'), { status: 503, code: 'LEAD_STATUS_NOT_INITIALIZED' });
    return status;
  }

  async ensureSource(name) {
    const sourceName = normalizeSource(name);
    let source = await LeadSource.findOne({ where: { name: sourceName } });
    if (!source) {
      source = await LeadSource.create({ name: sourceName, description: `${sourceName} lead source` });
    }
    return source;
  }

  async findOrCreateContact(payload) {
    const normalizedPhone = requireNormalizedPhone(payload.phone);
    const nameParts = payload.name ? splitName(payload.name) : {};
    const contactPayload = {
      firstName: payload.firstName || nameParts.firstName || null,
      lastName: payload.lastName || nameParts.lastName || null,
      phone: normalizedPhone,
      normalizedPhone,
      email: payload.email || null,
      status: 'new'
    };

    let contact = await Contact.findOne({
      where: { [Op.or]: [{ normalizedPhone }, { phone: normalizedPhone }, { whatsappId: normalizedPhone }] }
    });
    if (!contact) {
      return Contact.create(contactPayload);
    }

    const updates = {};
    ['firstName', 'lastName', 'email'].forEach((field) => {
      if (contactPayload[field] && contact[field] !== contactPayload[field]) {
        updates[field] = contactPayload[field];
      }
    });
    if (Object.keys(updates).length) {
      contact = await contact.update(updates);
    }
    return contact;
  }

  async createLead(contactId, options = {}) {
    const status = await this.ensureStatus(options.status || 'New');
    const source = await this.ensureSource(options.source || 'WhatsApp Ads');

    return Lead.create({
      contactId,
      ownerId: null,
      statusId: status.id,
      sourceId: source.id,
      priority: options.priority || 'medium',
      value: options.value || options.budget || null,
      budget: options.budget || null,
      courseInterested: options.courseInterested || null,
      batchInterested: options.batchInterested || null,
      studentType: options.studentType || null,
      notes: options.notes || null,
      stage: String(status.name).toLowerCase(),
      nextFollowupAt: options.nextFollowupAt || options.followUpDate || null
      , whatsappAccountId: options.whatsappAccountId || null
    });
  }

  buildLeadWhere({ assignedAgentId, courseInterested, whatsappAccountId, dateType, dateFrom, dateTo } = {}) {
    const where = {};
    if (assignedAgentId) where.ownerId = assignedAgentId;
    if (courseInterested) where.courseInterested = courseInterested;
    if (whatsappAccountId) where.whatsappAccountId = whatsappAccountId;
    const range = colomboDateRange(dateFrom, dateTo);
    if (range) {
      const fields = { createdAt: 'createdAt', updatedAt: 'updatedAt', convertedAt: 'convertedAt' };
      if (!fields[dateType || 'createdAt']) throw Object.assign(new Error('The selected date type is invalid.'), { status: 422, code: 'INVALID_DATE_RANGE' });
      where[fields[dateType || 'createdAt']] = range;
    }
    return where;
  }

  async listLeads({ page = 1, limit = 20, search, status, source, assignedAgentId, courseInterested, whatsappAccountId, dateType, dateFrom, dateTo } = {}, actor = null) {
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const where = this.buildLeadWhere({ assignedAgentId, courseInterested, whatsappAccountId, dateType, dateFrom, dateTo });
    if(actor&&!actor.isSystemAdmin&&!actor.permissions?.includes('lead.view_all')&&!actor.permissions?.includes('lead.view_team'))where[Op.or]=[{ownerId:actor.id},{ownerId:null}];
    const registeredDateFilter = (dateFrom || dateTo) && dateType === 'convertedAt';
    const include = this.buildLeadIncludes({ search, status: status || (registeredDateFilter ? 'registered' : status), source });

    const { count, rows } = await Lead.findAndCountAll({
      where,
      include,
      distinct: true,
      order: [['created_at', 'DESC']],
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit
    });

    await this.attachConversationIds(rows);
    return {
      leads: rows.map(serializeLead),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: count,
        pages: Math.ceil(count / safeLimit)
      }
    };
  }

  buildLeadIncludes({ search, status, source, includeHistory = false } = {}) {
    const contactWhere = {};
    const statusWhere = {};
    const sourceWhere = {};

    if (search) {
      const term = `%${search}%`;
      contactWhere[Op.or] = [
        { firstName: { [Op.iLike]: term } },
        { lastName: { [Op.iLike]: term } },
        { phone: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
        sequelize.where(fn('concat', col('contact.first_name'), ' ', col('contact.last_name')), { [Op.iLike]: term })
      ];
    }
    if (status) statusWhere.code = normalizeLeadStatusCode(status);
    if (source) sourceWhere.name = normalizeSource(source);

    const includes = [
      { model: Contact, as: 'contact', where: contactWhere, required: !!search },
      { model: LeadStatus, as: 'status', where: statusWhere, required: !!status },
      { model: LeadSource, as: 'source', where: sourceWhere, required: !!source },
      { model: User, as: 'owner', attributes: ['id', 'firstName', 'lastName', 'email'] }
    ];

    if (includeHistory) {
      includes.push({
        model: LeadAssignment,
        as: 'assignments',
        required: false,
        include: [
          { model: User, as: 'assignee', attributes: ['id', 'firstName', 'lastName', 'email'] },
          { model: User, as: 'assigner', attributes: ['id', 'firstName', 'lastName', 'email'] }
        ]
      });
    }

    return includes;
  }

  async getLeadById(id, actor = null) {
    const lead = await Lead.findByPk(id, {
      include: this.buildLeadIncludes({ includeHistory: true }),
      order: [[{ model: LeadAssignment, as: 'assignments' }, 'assigned_at', 'DESC']]
    });
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }
    if(actor&&lead.ownerId&&String(lead.ownerId)!==String(actor.id)&&!actor.isSystemAdmin&&!actor.permissions?.includes('lead.view_all')&&!actor.permissions?.includes('lead.view_team'))throw Object.assign(new Error('You do not have access to this lead'),{status:403,code:'LEAD_ACCESS_FORBIDDEN'});
    await this.attachConversationIds([lead]);
    return serializeLead(lead);
  }

  async attachConversationIds(leads) {
    if (!leads.length) return leads;
    const leadIds = leads.map((lead) => lead.id);
    const contactIds = leads.map((lead) => lead.contactId).filter(Boolean);
    const direct = await Conversation.findAll({
      where: { [Op.or]: [{ leadId: { [Op.in]: leadIds } }, { contactId: { [Op.in]: contactIds } }] },
      attributes: ['id', 'leadId', 'contactId', 'updatedAt'], order: [['updated_at', 'DESC']]
    });
    for (const lead of leads) {
      const exact = direct.find((row) => String(row.leadId || '') === String(lead.id));
      const contactMatch = direct.find((row) => String(row.contactId || '') === String(lead.contactId));
      if (exact || contactMatch) lead.setDataValue('resolvedConversationId', (exact || contactMatch).id);
    }
    const unresolved = leads.filter((lead) => !lead.getDataValue('resolvedConversationId'));
    if (unresolved.length) {
      const wanted = new Map(unresolved.map((lead) => [normalizeSriLankanPhone(lead.contact?.phone), lead]).filter(([phone]) => phone));
      const [candidates, contacts] = await Promise.all([
        Conversation.findAll({ include: [{ model: Contact, as: 'contact', required: true }], order: [['updated_at', 'DESC']] }),
        Contact.findAll({ attributes: ['id', 'phone'] })
      ]);
      for (const [phone, lead] of wanted) {
        const matches = candidates.filter((row) => normalizeSriLankanPhone(row.contact?.phone) === phone);
        const matchingContacts = contacts.filter((contact) => normalizeSriLankanPhone(contact.phone) === phone);
        if (matches.length === 1 && matchingContacts.length === 1) lead.setDataValue('resolvedConversationId', matches[0].id);
      }
    }
    return leads;
  }

  async updateStatus(id, payload, actor) {
    if (!actor?.id) throw Object.assign(new Error('Authentication is required.'), { status: 401, code: 'AUTH_REQUIRED' });
    const { statusCode, statusId, expectedCurrentStatusCode } = normalizeLeadStatusPayload(payload);
    return leadStatusService.changeStatus({
      leadId: id, statusCode, statusId, expectedCurrentStatusCode,
      actorUserId: actor.id, actor, source: payload.source === 'chat_workspace' ? 'chat_workspace' : 'leads_page'
    });
  }

  async createManualLead(payload, actor = null) {
    if(actor&&!actor.isSystemAdmin&&!actor.permissions?.includes('lead.assign'))payload={...payload,assignedAgentId:actor.id};
    const contact = await this.findOrCreateContact(payload);
    const lead = await this.createLead(contact.id, {
      ...payload,
      ownerId: payload.assignedAgentId || null,
      followUpDate: payload.followUpDate
    });
    await LeadActivity.create({leadId:lead.id,actorUserId:actor?.id||null,activityType:'LEAD_CREATED',action:'LEAD_CREATED',newValue:{statusId:lead.statusId,ownerId:lead.ownerId},note:lead.notes});

    if (payload.assignedAgentId) {
      await assignmentService.assignLead(lead.id, null, {
        assignedTo: payload.assignedAgentId,
        actor,
        source: 'leads_page',
        note: 'Assigned during lead creation'
      });
    }

    return this.getLeadById(lead.id);
  }

  async updateLead(id, payload, actor = null) {
    let lead = await Lead.findByPk(id, { include: [{ model: Contact, as: 'contact' }] });
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }
    if(actor&&lead.ownerId&&String(lead.ownerId)!==String(actor.id)&&!actor.isSystemAdmin&&!actor.permissions?.includes('lead.update_all'))throw Object.assign(new Error('You cannot update another agent’s lead'),{status:403,code:'LEAD_OWNED_BY_ANOTHER_AGENT'});
    if(actor&&payload.assignedAgentId!==undefined&&String(payload.assignedAgentId||'')!==String(lead.ownerId||'')&&!actor.isSystemAdmin&&!actor.permissions?.includes('lead.reassign'))throw Object.assign(new Error('Lead reassignment permission required'),{status:403,code:'LEAD_REASSIGN_FORBIDDEN'});

    if (payload.phone || payload.email || payload.name || payload.firstName || payload.lastName) {
      const nameParts = payload.name ? splitName(payload.name) : {};
      await lead.contact.update({
        firstName: payload.firstName ?? nameParts.firstName ?? lead.contact.firstName,
        lastName: payload.lastName ?? nameParts.lastName ?? lead.contact.lastName,
        phone: payload.phone ?? lead.contact.phone,
        email: payload.email ?? lead.contact.email
      });
    }

    const updates = {};
    if (payload.status) {
      await leadStatusService.changeStatus({ leadId: id, statusCode: payload.status, actorUserId: actor?.id || null, actor, source: actor ? 'leads_page' : 'workflow' });
      lead = await Lead.findByPk(id, { include: [{ model: Contact, as: 'contact' }] });
    }
    if (payload.source) {
      const source = await this.ensureSource(payload.source);
      updates.sourceId = source.id;
    }
    if (payload.priority) updates.priority = payload.priority;
    if (payload.courseInterested !== undefined) updates.courseInterested = payload.courseInterested;
    if (payload.batchInterested !== undefined) updates.batchInterested = payload.batchInterested;
    if (payload.budget !== undefined) {
      updates.budget = payload.budget;
      updates.value = payload.budget;
    }
    if (payload.studentType !== undefined) updates.studentType = payload.studentType;
    if (payload.notes !== undefined) updates.notes = payload.notes;
    if (payload.followUpDate !== undefined) updates.nextFollowupAt = payload.followUpDate;
    await lead.update(updates);
    if(payload.notes!==undefined)await LeadActivity.create({leadId:id,actorUserId:actor?.id||null,activityType:'NOTE_ADDED',action:'NOTE_ADDED',newValue:{note:payload.notes},note:String(payload.notes||'').trim().slice(0,4000)});

    if (payload.assignedAgentId !== undefined) {
      await leadAssignmentService.assignAgent({
        leadId: id, ownerId: payload.assignedAgentId || null, actor,
        source: 'leads_page', reason: 'Lead reassigned from edit form'
      });
    }

    return this.getLeadById(id);
  }

  async deleteLead(id) {
    const lead = await Lead.findByPk(id);
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }
    await lead.destroy();
    return { deleted: true, id };
  }

  async assignLead(id, { assignedAgentId, assignedById = null, note }, actor = null) {
    const lead = await Lead.findByPk(id);
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }
    await leadAssignmentService.assignAgent({
      leadId: id, ownerId: assignedAgentId, actor, actorUserId: assignedById,
      source: 'leads_page', reason: note
    });
    return this.getLeadById(id);
  }

  async autoAssign({ leadIds, limit = 25, assignedById = null } = {}) {
    const where = leadIds?.length ? { id: leadIds } : { ownerId: null };
    const leads = await Lead.findAll({
      where,
      order: [['created_at', 'ASC']],
      limit
    });

    const assigned = [];
    for (const lead of leads) {
      const result = await assignmentService.assignLead(lead.id, assignedById);
      assigned.push({
        leadId: lead.id,
        assignedAgent: serializeAgent(result.assignee)
      });
    }

    return {
      requested: leadIds?.length || leads.length,
      assignedCount: assigned.length,
      assigned
    };
  }

  async getOpenLeadForContact(contactId, whatsappAccountId = null) {
    return Lead.findOne({
      where: { contactId, ...(whatsappAccountId ? { whatsappAccountId } : {}) },
      order: [['created_at', 'DESC']]
    });
  }

  async updateLeadAiData(leadId, payload = {}) {
    const lead = await Lead.findByPk(leadId);
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }
    return lead.update(payload);
  }

  async assignOwner(leadId, ownerId) {
    await leadAssignmentService.assignAgent({ leadId, ownerId, source: 'workflow' });
    return Lead.findByPk(leadId);
  }
}

module.exports = new LeadService();
module.exports.normalizeLeadStatusPayload = normalizeLeadStatusPayload;
