const { Op, fn, col } = require('sequelize');
const { sequelize, Contact, Lead, LeadAssignment, LeadStatus, LeadSource, User } = require('../models');
const assignmentService = require('./assignment.service');

const DEFAULT_STATUSES = ['New', 'Contacted', 'Interested', 'Not Interested', 'Converted', 'Lost'];
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
  const normalized = String(name).trim().toLowerCase();
  const found = DEFAULT_STATUSES.find((status) => status.toLowerCase() === normalized);
  return found || name;
}

function normalizeSource(name) {
  if (!name) return 'Manual Entry';
  const normalized = String(name).trim().toLowerCase();
  const found = DEFAULT_SOURCES.find((source) => source.toLowerCase() === normalized);
  return found || name;
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
  async ensureDefaultLookups() {
    await Promise.all([
      ...DEFAULT_STATUSES.map((name) => this.ensureStatus(name)),
      ...DEFAULT_SOURCES.map((name) => this.ensureSource(name))
    ]);
  }

  async getStatusByName(name) {
    return LeadStatus.findOne({ where: { name: normalizeStatus(name) } });
  }

  async getSourceByName(name) {
    return LeadSource.findOne({ where: { name: normalizeSource(name) } });
  }

  async ensureStatus(name) {
    const statusName = normalizeStatus(name);
    let status = await LeadStatus.findOne({ where: { name: statusName } });
    if (!status) {
      status = await LeadStatus.create({ name: statusName, description: `${statusName} lead status` });
    }
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
    const nameParts = payload.name ? splitName(payload.name) : {};
    const contactPayload = {
      firstName: payload.firstName || nameParts.firstName || null,
      lastName: payload.lastName || nameParts.lastName || null,
      phone: payload.phone,
      email: payload.email || null,
      status: 'new'
    };

    let contact = await Contact.findOne({ where: { phone: payload.phone } });
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
      ownerId: options.ownerId || null,
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
    });
  }

  buildLeadWhere({ status, source, assignedAgentId, courseInterested } = {}) {
    const where = {};
    if (assignedAgentId) where.ownerId = assignedAgentId;
    if (courseInterested) where.courseInterested = courseInterested;
    return where;
  }

  async listLeads({ page = 1, limit = 20, search, status, source, assignedAgentId, courseInterested } = {}) {
    await this.ensureDefaultLookups();
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const where = this.buildLeadWhere({ assignedAgentId, courseInterested });
    const include = this.buildLeadIncludes({ search, status, source });

    const { count, rows } = await Lead.findAndCountAll({
      where,
      include,
      distinct: true,
      order: [['created_at', 'DESC']],
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit
    });

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
    if (status) statusWhere.name = normalizeStatus(status);
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

  async getLeadById(id) {
    const lead = await Lead.findByPk(id, {
      include: this.buildLeadIncludes({ includeHistory: true }),
      order: [[{ model: LeadAssignment, as: 'assignments' }, 'assigned_at', 'DESC']]
    });
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }
    return serializeLead(lead);
  }

  async createManualLead(payload) {
    await this.ensureDefaultLookups();
    const contact = await this.findOrCreateContact(payload);
    const lead = await this.createLead(contact.id, {
      ...payload,
      ownerId: payload.assignedAgentId || null,
      followUpDate: payload.followUpDate
    });

    if (payload.assignedAgentId) {
      await assignmentService.assignLead(lead.id, null, {
        assignedTo: payload.assignedAgentId,
        note: 'Assigned during lead creation'
      });
    }

    return this.getLeadById(lead.id);
  }

  async updateLead(id, payload) {
    const lead = await Lead.findByPk(id, { include: [{ model: Contact, as: 'contact' }] });
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }

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
      const status = await this.ensureStatus(payload.status);
      updates.statusId = status.id;
      updates.stage = String(status.name).toLowerCase();
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
    if (payload.assignedAgentId !== undefined) updates.ownerId = payload.assignedAgentId;

    await lead.update(updates);

    if (payload.assignedAgentId) {
      await assignmentService.assignLead(id, null, {
        assignedTo: payload.assignedAgentId,
        note: 'Lead reassigned from edit form'
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

  async assignLead(id, { assignedAgentId, assignedById = null, note }) {
    const lead = await Lead.findByPk(id);
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }

    await assignmentService.assignLead(id, assignedById, {
      assignedTo: assignedAgentId,
      note
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

  async getOpenLeadForContact(contactId) {
    return Lead.findOne({
      where: { contactId },
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
    const lead = await Lead.findByPk(leadId);
    if (!lead) {
      const error = new Error('Lead not found');
      error.status = 404;
      throw error;
    }

    await lead.update({ ownerId });
    return lead;
  }
}

module.exports = new LeadService();
