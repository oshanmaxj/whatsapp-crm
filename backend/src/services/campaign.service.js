const { Op, fn, col } = require('sequelize');
const {
  sequelize,
  Campaign,
  CampaignEvent,
  CampaignRecipient,
  Contact,
  Lead,
  LeadSource,
  LeadStatus,
  MessageTemplate,
  User
} = require('../models');
const whatsappService = require('./whatsapp.service');

function fullName(contact) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.phone || 'Unknown';
}

function renderTemplate(text = '', variables = {}, recipient = {}) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    if (variables[key] !== undefined) return variables[key];
    if (key === 'name') return recipient.name || '';
    if (key === 'phone') return recipient.phone || '';
    return '';
  });
}

function normalizeAudienceOptions(options = {}) {
  const {
    audienceType = 'contacts',
    limit = 50,
    filters: nestedFilters,
    status,
    tag,
    source,
    courseInterested,
    assignedAgentId
  } = options;

  return {
    audienceType,
    limit: Math.min(Math.max(Number(limit) || 50, 1), 10000),
    filters: {
      ...(nestedFilters || {}),
      ...(status ? { status } : {}),
      ...(tag ? { tag } : {}),
      ...(source ? { source } : {}),
      ...(courseInterested ? { courseInterested } : {}),
      ...(assignedAgentId ? { assignedAgentId } : {})
    }
  };
}

class CampaignService {
  async listCampaigns() {
    return Campaign.findAll({
      include: [
        { model: MessageTemplate, as: 'template', required: false },
        { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'], required: false }
      ],
      order: [['created_at', 'DESC']]
    });
  }

  async getCampaign(id) {
    const campaign = await Campaign.findByPk(id, {
      include: [
        { model: MessageTemplate, as: 'template', required: false },
        { model: CampaignRecipient, as: 'recipients', required: false },
        { model: CampaignEvent, as: 'events', required: false }
      ]
    });
    if (!campaign) {
      const error = new Error('Campaign not found');
      error.status = 404;
      throw error;
    }
    return campaign;
  }

  async createCampaign(payload, createdBy) {
    const template = payload.templateId ? await MessageTemplate.findByPk(payload.templateId) : null;
    if (!payload.name || !(payload.messageBody || template?.body)) {
      const error = new Error('Campaign name and message body are required');
      error.status = 400;
      throw error;
    }
    return Campaign.create({
      name: payload.name,
      description: payload.description || null,
      status: payload.status || (payload.scheduledAt ? 'Scheduled' : 'Draft'),
      audienceType: payload.audienceType || 'contacts',
      filters: payload.filters || {},
      templateId: payload.templateId || null,
      templateName: template?.name || payload.templateName || null,
      messageBody: payload.messageBody || template?.body || '',
      variables: payload.variables || {},
      mediaId: payload.mediaId || null,
      scheduledAt: payload.scheduledAt || null,
      createdBy
    });
  }

  async updateCampaign(id, payload) {
    const campaign = await this.getCampaign(id);
    if (['Processing', 'Completed', 'Cancelled'].includes(campaign.status)) {
      const error = new Error('Processing, completed, or cancelled campaigns cannot be edited');
      error.status = 409;
      throw error;
    }
    await campaign.update(payload);
    return this.getCampaign(id);
  }

  async deleteCampaign(id) {
    const campaign = await this.getCampaign(id);
    await campaign.destroy();
    return { deleted: true, id };
  }

  async previewAudience(options = {}) {
    let { audienceType, filters, limit } = normalizeAudienceOptions(options);
    const byPhone = new Map();

    if (audienceType === 'contacts' || audienceType === 'mixed') {
      const contacts = await this.findContacts(filters, limit);
      contacts.forEach((contact) => byPhone.set(contact.phone, {
        contactId: contact.id,
        leadId: null,
        phone: contact.phone,
        name: fullName(contact),
        email: contact.email,
        source: null,
        status: contact.status,
        courseInterested: null,
        assignedAgent: null
      }));
    }

    if (audienceType === 'leads' || audienceType === 'mixed') {
      const leads = await this.findLeads(filters, limit);
      leads.forEach((lead) => {
        if (!lead.contact?.phone) return;
        byPhone.set(lead.contact.phone, {
          contactId: lead.contact.id,
          leadId: lead.id,
          phone: lead.contact.phone,
          name: fullName(lead.contact),
          email: lead.contact.email,
          source: lead.source?.name || null,
          status: lead.status?.name || null,
          courseInterested: lead.courseInterested,
          assignedAgent: lead.owner ? fullName(lead.owner) : null
        });
      });
    }

    const recipients = Array.from(byPhone.values());
    return {
      total: recipients.length,
      recipients: recipients.slice(0, limit)
    };
  }

  async findContacts(filters, limit) {
    const where = {};
    if (filters.status) where.status = filters.status;
    if (filters.tag) {
      where[Op.and] = [sequelize.literal(`"Contact"."tags"::jsonb ? ${sequelize.escape(filters.tag)}`)];
    }
    return Contact.findAll({ where, order: [['created_at', 'DESC']], limit });
  }

  async findLeads(filters, limit) {
    const where = {};
    if (filters.courseInterested) where.courseInterested = filters.courseInterested;
    if (filters.assignedAgentId) where.ownerId = filters.assignedAgentId;
    return Lead.findAll({
      where,
      include: [
        { model: Contact, as: 'contact', required: true },
        { model: LeadStatus, as: 'status', where: filters.status ? { name: filters.status } : undefined, required: !!filters.status },
        { model: LeadSource, as: 'source', where: filters.source ? { name: filters.source } : undefined, required: !!filters.source },
        { model: User, as: 'owner', attributes: ['id', 'firstName', 'lastName', 'email'], required: false }
      ],
      order: [['created_at', 'DESC']],
      limit
    });
  }

  async ensureRecipients(campaign) {
    const existing = await CampaignRecipient.count({ where: { campaignId: campaign.id } });
    if (existing > 0) return CampaignRecipient.findAll({ where: { campaignId: campaign.id } });

    const audience = await this.previewAudience({
      audienceType: campaign.audienceType,
      filters: campaign.filters,
      limit: 10000
    });

    const rows = await CampaignRecipient.bulkCreate(
      audience.recipients.map((recipient) => ({
        campaignId: campaign.id,
        contactId: recipient.contactId,
        leadId: recipient.leadId,
        phone: recipient.phone,
        name: recipient.name,
        status: 'pending'
      }))
    );

    return rows;
  }

  async sendCampaign(id) {
    const campaign = await this.getCampaign(id);
    if (campaign.status === 'Cancelled') {
      const error = new Error('Cancelled campaigns cannot be sent');
      error.status = 409;
      throw error;
    }

    const recipients = await this.ensureRecipients(campaign);
    await campaign.update({ status: 'Processing' });

    const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
    for (const recipient of recipients) {
      await recipient.update({ status: 'queued' });
      await CampaignEvent.create({ campaignId: campaign.id, recipientId: recipient.id, eventType: 'queued' });
      const body = renderTemplate(campaign.messageBody, campaign.variables, recipient);

      try {
        if (realSendEnabled) {
          await whatsappService.sendTextMessage({ to: recipient.phone, text: body });
          await recipient.update({ status: 'sent', sentAt: new Date() });
          await CampaignEvent.create({ campaignId: campaign.id, recipientId: recipient.id, eventType: 'sent' });
        } else {
          await recipient.update({ status: 'simulated_sent', sentAt: new Date() });
          await CampaignEvent.create({
            campaignId: campaign.id,
            recipientId: recipient.id,
            eventType: 'simulated_sent',
            payload: { body, realSendEnabled: false }
          });
        }
      } catch (error) {
        await recipient.update({ status: 'failed', errorMessage: error.message });
        await CampaignEvent.create({ campaignId: campaign.id, recipientId: recipient.id, eventType: 'failed', payload: { error: error.message } });
      }
    }

    const failed = await CampaignRecipient.count({ where: { campaignId: campaign.id, status: 'failed' } });
    await campaign.update({ status: failed ? 'Failed' : 'Completed', sentAt: new Date() });
    return this.getCampaign(id);
  }

  async cancelCampaign(id) {
    const campaign = await this.getCampaign(id);
    if (!['Draft', 'Scheduled'].includes(campaign.status)) {
      const error = new Error('Only draft or scheduled campaigns can be cancelled');
      error.status = 409;
      throw error;
    }
    await campaign.update({ status: 'Cancelled' });
    await CampaignEvent.create({ campaignId: campaign.id, eventType: 'cancelled' });
    return this.getCampaign(id);
  }

  async getAnalytics(id) {
    const campaign = await this.getCampaign(id);
    const rows = await CampaignRecipient.findAll({
      where: { campaignId: id },
      attributes: ['status', [fn('count', col('id')), 'count']],
      group: ['status'],
      raw: true
    });
    const counts = rows.reduce((acc, row) => ({ ...acc, [row.status]: Number(row.count) }), {});
    const totalTargeted = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const sent = (counts.sent || 0) + (counts.simulated_sent || 0) + (counts.delivered || 0) + (counts.read || 0) + (counts.replied || 0) + (counts.converted || 0);
    const delivered = (counts.delivered || 0) + (counts.read || 0) + (counts.replied || 0) + (counts.converted || 0);
    const read = (counts.read || 0) + (counts.replied || 0) + (counts.converted || 0);
    const replied = (counts.replied || 0) + (counts.converted || 0);
    const failed = counts.failed || 0;
    const unreachable = counts.unreachable || 0;
    const conversionCount = counts.converted || 0;

    const rate = (value) => (totalTargeted ? Math.round((value / totalTargeted) * 10000) / 100 : 0);

    return {
      campaign,
      totals: { totalTargeted, sent, delivered, read, failed, unreachable, replied, conversionCount },
      rates: {
        deliveryRate: rate(delivered),
        readRate: rate(read),
        replyRate: rate(replied),
        failureRate: rate(failed + unreachable)
      },
      byStatus: counts,
      failureReport: await CampaignRecipient.findAll({
        where: { campaignId: id, status: { [Op.in]: ['failed', 'unreachable'] } },
        order: [['updated_at', 'DESC']]
      })
    };
  }
}

module.exports = new CampaignService();
