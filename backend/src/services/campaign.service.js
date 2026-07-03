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
  Role,
  User,
  WhatsAppTemplate
} = require('../models');
const messageQueueService = require('./messageQueue.service');
const whatsappComplianceService = require('./whatsappCompliance.service');

function fullName(person) {
  return [person?.firstName, person?.lastName].filter(Boolean).join(' ') || person?.name || person?.phone || 'Unknown';
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

function validWhatsAppPhone(phone) {
  return /^\d{7,15}$/.test(normalizePhone(phone));
}

function parseDateBoundary(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw Object.assign(new Error(`${endOfDay ? 'End' : 'Start'} date must use YYYY-MM-DD format`), { status: 422 });
  }
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() + 1 !== month
    || date.getDate() !== day
  ) {
    throw Object.assign(new Error(`Invalid ${endOfDay ? 'end' : 'start'} date`), { status: 422 });
  }
  return date;
}

function normalizeIds(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(',');
  return [...new Set(source.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

function resolveVariable(source, recipient, campaign) {
  const data = recipient.variableData || {};
  const key = String(source || '').trim();
  const now = new Date();
  const values = {
    contact_name: recipient.name || '',
    name: recipient.name || '',
    phone: recipient.phone || '',
    course_name: data.courseInterested || '',
    course: data.courseInterested || '',
    date: now.toLocaleDateString('en-CA'),
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date_time: now.toISOString(),
    campaign_name: campaign.name || ''
  };
  return values[key] ?? data[key] ?? key;
}

function templateComponents(campaign, recipient) {
  const mappings = campaign.variables || {};
  const keys = Object.keys(mappings).sort((a, b) => Number(a) - Number(b));
  if (!keys.length) return [];
  return [{
    type: 'body',
    parameters: keys.map((key) => ({
      type: 'text',
      text: String(resolveVariable(mappings[key], recipient, campaign))
    }))
  }];
}

function legacyMessageBody(campaign, recipient) {
  return String(campaign.messageBody || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => (
    String(resolveVariable(campaign.variables?.[key] ?? key, recipient, campaign))
  ));
}

function parseCsv(csv = '') {
  const lines = String(csv).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"' && quoted) { cell += '"'; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(cell.trim()); cell = ''; }
      else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((value, index) => [headers[index], value])));
}

class CampaignService {
  async listCampaigns() {
    const campaigns = await Campaign.findAll({
      include: [
        { model: MessageTemplate, as: 'template', required: false },
        { model: WhatsAppTemplate, as: 'whatsappTemplate', required: false },
        { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
        { model: CampaignRecipient, as: 'recipients', attributes: ['id', 'status'], required: false }
      ],
      order: [['created_at', 'DESC']]
    });
    return campaigns.map((campaign) => {
      const json = campaign.toJSON();
      json.recipientCount = json.recipients?.length || 0;
      json.queuedCount = json.recipients?.filter((item) => item.status === 'queued').length || 0;
      delete json.recipients;
      return json;
    });
  }

  async getCampaign(id) {
    const campaign = await Campaign.findByPk(id, {
      include: [
        { model: MessageTemplate, as: 'template', required: false },
        { model: WhatsAppTemplate, as: 'whatsappTemplate', required: false },
        { model: CampaignRecipient, as: 'recipients', required: false },
        { model: CampaignEvent, as: 'events', required: false }
      ]
    });
    if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
    return campaign;
  }

  async approvedTemplate(id) {
    if (!id) throw Object.assign(new Error('Select an approved WhatsApp template'), { status: 422 });
    const template = await WhatsAppTemplate.findOne({ where: { id, status: 'APPROVED' } });
    if (!template) throw Object.assign(new Error('Selected WhatsApp template is not approved or no longer exists'), { status: 422 });
    return template;
  }

  async createCampaign(payload, createdBy) {
    if (!String(payload.name || '').trim()) throw Object.assign(new Error('Campaign name is required'), { status: 422 });
    const template = await this.approvedTemplate(payload.whatsappTemplateId || payload.templateId);
    const recipientSource = payload.recipient_source || payload.recipientSource;
    const filters = {
      ...(payload.filters || {}),
      ...(recipientSource ? {
        recipientSource,
        startDate: payload.start_date || payload.startDate,
        endDate: payload.end_date || payload.endDate,
        statusId: payload.status_id || payload.statusId || null,
        sourceId: payload.source_id || payload.sourceId || null
      } : {})
    };
    return Campaign.create({
      name: String(payload.name).trim(),
      description: payload.description || null,
      status: 'Draft',
      audienceType: recipientSource === 'lead_date_range' ? 'leads' : (payload.audienceType || 'contacts'),
      filters,
      whatsappTemplateId: template.id,
      templateName: template.name,
      messageBody: template.body,
      variables: payload.variables || {},
      mediaId: payload.mediaId || null,
      scheduledAt: payload.scheduledAt || null,
      createdBy
    });
  }

  async updateCampaign(id, payload) {
    const campaign = await this.getCampaign(id);
    if (['Processing', 'Completed', 'Cancelled'].includes(campaign.status)) {
      throw Object.assign(new Error('Processing, completed, or cancelled campaigns cannot be edited'), { status: 409 });
    }
    const updates = { ...payload };
    if (payload.whatsappTemplateId) {
      const template = await this.approvedTemplate(payload.whatsappTemplateId);
      updates.whatsappTemplateId = template.id;
      updates.templateName = template.name;
      updates.messageBody = template.body;
    }
    delete updates.status;
    await campaign.update(updates);
    return this.getCampaign(id);
  }

  async deleteCampaign(id) {
    const campaign = await this.getCampaign(id);
    if (campaign.status === 'Processing') throw Object.assign(new Error('A processing campaign cannot be deleted'), { status: 409 });
    await campaign.destroy();
    return { deleted: true, id };
  }

  async previewAudience(options = {}) {
    const recipientSource = options.recipient_source || options.recipientSource;
    const filters = {
      ...(options.filters || options),
      ...(recipientSource ? {
        recipientSource,
        startDate: options.start_date || options.startDate,
        endDate: options.end_date || options.endDate,
        statusId: options.status_id || options.statusId || null,
        sourceId: options.source_id || options.sourceId || null
      } : {})
    };
    const audienceType = recipientSource === 'lead_date_range'
      || filters.recipientSource === 'lead_date_range'
      ? 'leads'
      : (options.audienceType || 'contacts');
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 10000);
    const byPhone = new Map();

    if (audienceType === 'contacts' || audienceType === 'mixed') {
      const contacts = await this.findContacts(filters, limit);
      contacts.forEach((contact) => {
        const phone = normalizePhone(contact.phone);
        if (!validWhatsAppPhone(phone)) return;
        byPhone.set(phone, {
          contactId: contact.id, leadId: null, phone, name: fullName(contact),
          email: contact.email, status: contact.status, source: null, courseInterested: null
        });
      });
    }
    if (audienceType === 'leads' || audienceType === 'mixed') {
      const leads = await this.findLeads(filters, limit);
      leads.forEach((lead) => {
        const phone = normalizePhone(lead.contact?.phone);
        if (!validWhatsAppPhone(phone)) return;
        byPhone.set(phone, {
          contactId: lead.contact.id, leadId: lead.id, phone, name: fullName(lead.contact),
          email: lead.contact.email, source: lead.source?.name || null, status: lead.status?.name || null,
          courseInterested: lead.courseInterested, assignedAgent: fullName(lead.owner)
        });
      });
    }
    const recipients = Array.from(byPhone.values());
    return { total: recipients.length, recipients: recipients.slice(0, limit) };
  }

  async findContacts(filters, limit) {
    const where = {};
    const selectedIds = normalizeIds(filters.contactIds || filters.selectedContactIds);
    if (selectedIds.length) where.id = { [Op.in]: selectedIds };
    if (filters.status) where.status = filters.status;
    const tag = filters.tag || filters.label;
    if (tag) where[Op.and] = [sequelize.literal(`"Contact"."tags"::jsonb ? ${sequelize.escape(tag)}`)];
    return Contact.findAll({ where, order: [['created_at', 'DESC']], limit });
  }

  async findLeads(filters, limit) {
    const where = {};
    if (filters.courseInterested) where.courseInterested = filters.courseInterested;
    if (filters.assignedAgentId) where.ownerId = filters.assignedAgentId;
    if (filters.statusId || filters.status_id) where.statusId = Number(filters.statusId || filters.status_id);
    if (filters.sourceId || filters.source_id) where.sourceId = Number(filters.sourceId || filters.source_id);
    if (filters.recipientSource === 'lead_date_range' || filters.recipient_source === 'lead_date_range') {
      const startDate = parseDateBoundary(filters.startDate || filters.start_date);
      const endDate = parseDateBoundary(filters.endDate || filters.end_date, true);
      if (startDate > endDate) {
        throw Object.assign(new Error('Start date must be on or before end date'), { status: 422 });
      }
      where.createdAt = { [Op.gte]: startDate, [Op.lte]: endDate };
    }
    const ownerInclude = {
      model: User,
      as: 'owner',
      attributes: ['id', 'firstName', 'lastName', 'email'],
      required: Boolean(filters.departmentId),
      include: filters.departmentId ? [{
        model: Role, as: 'roles', attributes: ['id'], where: { id: filters.departmentId }, through: { attributes: [] }, required: true
      }] : []
    };
    return Lead.findAll({
      where,
      include: [
        { model: Contact, as: 'contact', required: true },
        { model: LeadStatus, as: 'status', where: filters.leadStatus || filters.status ? { name: filters.leadStatus || filters.status } : undefined, required: Boolean(filters.leadStatus || filters.status) },
        { model: LeadSource, as: 'source', where: filters.source ? { name: filters.source } : undefined, required: Boolean(filters.source) },
        ownerInclude
      ],
      order: [['created_at', 'DESC']],
      limit
    });
  }

  async audienceOptions() {
    const [statuses, sources] = await Promise.all([
      LeadStatus.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
      LeadSource.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] })
    ]);
    return { statuses, sources };
  }

  async importRecipients(id, payload = {}) {
    const campaign = await this.getCampaign(id);
    if (!['Draft', 'Scheduled', 'Failed'].includes(campaign.status)) {
      throw Object.assign(new Error('Recipients cannot be changed after campaign processing starts'), { status: 409 });
    }
    const input = Array.isArray(payload.recipients) ? payload.recipients : parseCsv(payload.csv);
    let imported = 0;
    let duplicates = 0;
    let invalid = 0;
    for (const item of input) {
      const phone = normalizePhone(item.phone || item.phone_number || item.whatsapp);
      if (!validWhatsAppPhone(phone)) { invalid += 1; continue; }
      const [recipient, created] = await CampaignRecipient.findOrCreate({
        where: { campaignId: campaign.id, phone },
        defaults: {
          campaignId: campaign.id,
          phone,
          name: item.name || item.contact_name || phone,
          status: 'pending',
          variableData: item
        }
      });
      if (created) imported += 1;
      else {
        duplicates += 1;
        await recipient.update({ variableData: { ...(recipient.variableData || {}), ...item } });
      }
    }
    return { imported, duplicates, invalid, total: await CampaignRecipient.count({ where: { campaignId: campaign.id } }) };
  }

  async ensureRecipients(campaign) {
    const existing = await CampaignRecipient.findAll({ where: { campaignId: campaign.id } });
    if (existing.length) return existing;
    const audience = await this.previewAudience({ audienceType: campaign.audienceType, filters: campaign.filters, limit: 10000 });
    for (const item of audience.recipients) {
      await CampaignRecipient.findOrCreate({
        where: { campaignId: campaign.id, phone: normalizePhone(item.phone) },
        defaults: {
          campaignId: campaign.id,
          contactId: item.contactId,
          leadId: item.leadId,
          phone: normalizePhone(item.phone),
          name: item.name,
          status: 'pending',
          variableData: item
        }
      });
    }
    return CampaignRecipient.findAll({ where: { campaignId: campaign.id } });
  }

  async queueCampaign(id, { scheduledAt = null } = {}) {
    const campaign = await this.getCampaign(id);
    if (campaign.status === 'Cancelled') throw Object.assign(new Error('Cancelled campaigns cannot be sent'), { status: 409 });
    const template = campaign.whatsappTemplateId
      ? await this.approvedTemplate(campaign.whatsappTemplateId)
      : await WhatsAppTemplate.findOne({ where: { name: campaign.templateName, status: 'APPROVED' } });
    if (!template && !String(campaign.messageBody || '').trim()) {
      throw Object.assign(new Error('This legacy campaign has no approved WhatsApp template or message body'), { status: 422 });
    }
    const recipients = await this.ensureRecipients(campaign);
    if (!recipients.length) throw Object.assign(new Error('No valid recipients matched this broadcast'), { status: 422 });
    const runAt = scheduledAt ? new Date(scheduledAt) : new Date();
    if (Number.isNaN(runAt.getTime())) throw Object.assign(new Error('Invalid schedule date/time'), { status: 422 });

    let queued = 0;
    let skipped = 0;
    for (const recipient of recipients) {
      if (['queued', 'sent', 'delivered', 'read', 'replied', 'converted'].includes(recipient.status)) { skipped += 1; continue; }
      const compliance = await whatsappComplianceService.validateTemplateUsage({
        contactId: recipient.contactId,
        templateId: template?.id || null,
        templateName: template?.name || campaign.templateName,
        messageType: template ? 'template' : 'free_form'
      });
      if (!compliance.allowed) {
        await recipient.update({ status: 'failed', errorMessage: compliance.reason });
        await CampaignEvent.create({
          campaignId: campaign.id,
          recipientId: recipient.id,
          eventType: 'failed',
          payload: { error: compliance.reason, compliance: true }
        });
        continue;
      }
      const queueItem = await messageQueueService.enqueue({
        channel: 'whatsapp',
        messageType: template ? 'template' : 'text',
        to: recipient.phone,
        scheduledAt: runAt,
        maxAttempts: 3,
        campaignId: campaign.id,
        campaignRecipientId: recipient.id,
        payload: template
          ? {
              to: recipient.phone,
              templateName: template.name,
              language: template.language,
              components: templateComponents(campaign, recipient),
              log: true
            }
          : {
              to: recipient.phone,
              text: legacyMessageBody(campaign, recipient),
              log: true
            }
      }, campaign.createdBy);
      await recipient.update({ status: 'queued', queueId: queueItem.id, errorMessage: null });
      await CampaignEvent.create({
        campaignId: campaign.id,
        recipientId: recipient.id,
        eventType: 'queued',
        payload: { queueId: queueItem.id, scheduledAt: runAt.toISOString() }
      });
      queued += 1;
    }
    if (!queued) {
      const failed = await CampaignRecipient.count({ where: { campaignId: campaign.id, status: { [Op.in]: ['failed', 'unreachable'] } } });
      if (failed) await campaign.update({ status: 'Failed', sentAt: new Date() });
      return { campaign: await this.getCampaign(id), queued, skipped };
    }
    const isFuture = runAt.getTime() > Date.now() + 1000;
    await campaign.update({
      status: isFuture ? 'Scheduled' : 'Processing',
      scheduledAt: isFuture ? runAt : campaign.scheduledAt
    });
    return { campaign: await this.getCampaign(id), queued, skipped };
  }

  async sendCampaign(id) {
    return this.queueCampaign(id, { scheduledAt: new Date() });
  }

  async scheduleCampaign(id, scheduledAt) {
    if (!scheduledAt) throw Object.assign(new Error('Schedule date/time is required'), { status: 422 });
    return this.queueCampaign(id, { scheduledAt });
  }

  async cancelCampaign(id) {
    const campaign = await this.getCampaign(id);
    if (!['Draft', 'Scheduled'].includes(campaign.status)) throw Object.assign(new Error('Only draft or scheduled campaigns can be cancelled'), { status: 409 });
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
    const totalRecipients = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const queued = counts.queued || 0;
    const sent = (counts.sent || 0) + (counts.delivered || 0) + (counts.read || 0) + (counts.replied || 0) + (counts.converted || 0);
    const delivered = (counts.delivered || 0) + (counts.read || 0) + (counts.replied || 0) + (counts.converted || 0);
    const read = (counts.read || 0) + (counts.replied || 0) + (counts.converted || 0);
    const failed = (counts.failed || 0) + (counts.unreachable || 0);
    const rate = (value, base = totalRecipients) => base ? Math.round((value / base) * 10000) / 100 : 0;
    return {
      campaign,
      totals: { totalRecipients, queued, sent, delivered, read, failed },
      rates: { deliveryRate: rate(delivered, sent), readRate: rate(read, delivered), failureRate: rate(failed) },
      byStatus: counts,
      failureReport: await CampaignRecipient.findAll({
        where: { campaignId: id, status: { [Op.in]: ['failed', 'unreachable'] } },
        order: [['updated_at', 'DESC']]
      })
    };
  }
}

module.exports = new CampaignService();
