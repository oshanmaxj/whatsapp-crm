const axios = require('axios');
const { Op } = require('sequelize');
const { WhatsAppTemplate } = require('../models');
const whatsappSettingsService = require('./whatsappSettings.service');

function componentsFromTemplate(template) {
  const components = [];
  if (template.headerType && template.headerType !== 'NONE') {
    components.push({
      type: 'HEADER',
      format: template.headerType,
      ...(template.headerType === 'TEXT' ? { text: template.headerContent || '' } : {})
    });
  }
  components.push({ type: 'BODY', text: template.body });
  if (template.footer) components.push({ type: 'FOOTER', text: template.footer });
  if (Array.isArray(template.buttons) && template.buttons.length) components.push({ type: 'BUTTONS', buttons: template.buttons });
  return components;
}

function normalizeMetaStatus(value) {
  const status = String(value || 'DRAFT').toUpperCase();
  if (['APPROVED', 'PENDING', 'REJECTED', 'DISABLED'].includes(status)) return status;
  return 'DRAFT';
}

function normalizeQuality(value) {
  const rating = String(value || 'UNKNOWN').toUpperCase();
  if (['HIGH', 'MEDIUM', 'LOW'].includes(rating)) return rating;
  return 'UNKNOWN';
}

class WhatsAppTemplateService {
  async list(query = {}) {
    const where = {};
    if (query.status) where.status = query.status;
    if (query.language) where.language = query.language;
    if (query.category) where.category = query.category;
    if (query.search) where.name = { [Op.iLike]: `%${query.search}%` };
    return WhatsAppTemplate.findAll({ where, order: [['updated_at', 'DESC']] });
  }

  async get(id) {
    const row = await WhatsAppTemplate.findByPk(id);
    if (!row) throw Object.assign(new Error('WhatsApp template not found'), { status: 404 });
    return row;
  }

  async create(payload) {
    if (!payload.name || !payload.body) throw Object.assign(new Error('Template name and body are required'), { status: 400 });
    return WhatsAppTemplate.create({
      name: payload.name,
      metaTemplateId: payload.metaTemplateId || null,
      category: payload.category || 'UTILITY',
      language: payload.language || 'en_US',
      headerType: payload.headerType || 'NONE',
      headerContent: payload.headerContent || null,
      body: payload.body,
      footer: payload.footer || null,
      buttons: Array.isArray(payload.buttons) ? payload.buttons : [],
      variables: Array.isArray(payload.variables) ? payload.variables : [],
      status: payload.status || 'DRAFT',
      qualityRating: payload.qualityRating || 'UNKNOWN'
    });
  }

  async update(id, payload) {
    const row = await this.get(id);
    await row.update(payload);
    return this.get(id);
  }

  async delete(id) {
    const row = await this.get(id);
    await row.destroy();
    return { deleted: true, id };
  }

  async submit(id) {
    const template = await this.get(id);
    const settings = await whatsappSettingsService.runtimeConfig();
    if (process.env.WHATSAPP_SEND_ENABLED !== 'true' || !settings.accessToken || !settings.businessAccountId) {
      await template.update({ status: 'PENDING', lastSyncedAt: new Date() });
      return { template: await this.get(id), simulated: true, message: 'Template submission simulated. Configure Meta credentials and enable WhatsApp sending for live submission.' };
    }

    const url = `${settings.apiBaseUrl}/${settings.apiVersion}/${settings.businessAccountId}/message_templates`;
    const response = await axios.post(url, {
      name: template.name,
      category: template.category,
      language: template.language,
      components: componentsFromTemplate(template)
    }, {
      headers: { Authorization: `Bearer ${settings.accessToken}`, 'Content-Type': 'application/json' },
      timeout: 20000
    });

    await template.update({
      metaTemplateId: response.data?.id || template.metaTemplateId,
      status: 'PENDING',
      lastSyncedAt: new Date()
    });
    return { template: await this.get(id), meta: response.data, simulated: false };
  }

  async sync() {
    const settings = await whatsappSettingsService.runtimeConfig();
    if (!settings.accessToken || !settings.businessAccountId) {
      return { synced: 0, simulated: true, message: 'Business account ID and access token are required to sync Meta templates.' };
    }

    const url = `${settings.apiBaseUrl}/${settings.apiVersion}/${settings.businessAccountId}/message_templates`;
    const response = await axios.get(url, {
      params: { fields: 'id,name,category,language,status,quality_score,components' },
      headers: { Authorization: `Bearer ${settings.accessToken}` },
      timeout: 20000
    });

    const rows = response.data?.data || [];
    for (const item of rows) {
      const body = item.components?.find((component) => component.type === 'BODY')?.text || '';
      const header = item.components?.find((component) => component.type === 'HEADER');
      const footer = item.components?.find((component) => component.type === 'FOOTER');
      const buttons = item.components?.find((component) => component.type === 'BUTTONS')?.buttons || [];
      await WhatsAppTemplate.findOrCreate({
        where: { metaTemplateId: item.id },
        defaults: {
          name: item.name,
          metaTemplateId: item.id,
          category: item.category || 'UTILITY',
          language: item.language || 'en_US',
          headerType: header?.format || 'NONE',
          headerContent: header?.text || null,
          body: body || item.name,
          footer: footer?.text || null,
          buttons,
          variables: [],
          status: normalizeMetaStatus(item.status),
          qualityRating: normalizeQuality(item.quality_score?.score || item.quality_rating),
          lastSyncedAt: new Date()
        }
      }).then(async ([template, created]) => {
        if (!created) {
          await template.update({
            name: item.name,
            category: item.category || template.category,
            language: item.language || template.language,
            headerType: header?.format || 'NONE',
            headerContent: header?.text || null,
            body: body || template.body,
            footer: footer?.text || null,
            buttons,
            status: normalizeMetaStatus(item.status),
            qualityRating: normalizeQuality(item.quality_score?.score || item.quality_rating),
            lastSyncedAt: new Date()
          });
        }
      });
    }
    return { synced: rows.length, simulated: false };
  }

  async approvedTemplateByName(name) {
    if (!name) return null;
    return WhatsAppTemplate.findOne({ where: { name, status: 'APPROVED' } });
  }
}

module.exports = new WhatsAppTemplateService();
