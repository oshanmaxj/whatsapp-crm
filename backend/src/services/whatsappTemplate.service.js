const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { WhatsAppTemplate } = require('../models');
const whatsappSettingsService = require('./whatsappSettings.service');

function componentsFromTemplate(template) {
  const components = [];
  if (template.headerType && template.headerType !== 'NONE') {
    const header = {
      type: 'HEADER',
      format: template.headerType,
      ...(template.headerType === 'TEXT' ? { text: template.headerContent || '' } : {})
    };
    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(template.headerType)) {
      header.example = { header_handle: [template.headerContent] };
    }
    components.push(header);
  }
  components.push({ type: 'BODY', text: template.body });
  if (template.footer) components.push({ type: 'FOOTER', text: template.footer });
  if (Array.isArray(template.buttons) && template.buttons.length) components.push({ type: 'BUTTONS', buttons: template.buttons });
  return components;
}

function metaApiError(error, action) {
  const meta = error.response?.data?.error || error.response?.data;
  const message = meta?.error_user_msg || meta?.message || error.message || `Unable to ${action}`;
  const wrapped = new Error(`Meta API: ${message}`);
  wrapped.status = error.response?.status >= 400 && error.response?.status < 500
    ? error.response.status
    : 502;
  wrapped.details = [{
    message,
    code: meta?.code || null,
    subcode: meta?.error_subcode || null,
    traceId: meta?.fbtrace_id || null
  }];
  wrapped.exposeMessage = true;
  return wrapped;
}

function validateTemplatePayload(payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name) throw Object.assign(new Error('Template name is required'), { status: 422 });
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw Object.assign(new Error('Template name must use lowercase snake_case (letters, numbers, and underscores only)'), { status: 422 });
  }
  if (!String(payload.body || '').trim()) {
    throw Object.assign(new Error('Template body is required'), { status: 422 });
  }
  const headerType = String(payload.headerType || 'NONE').toUpperCase();
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && !String(payload.headerContent || '').trim()) {
    throw Object.assign(new Error(`${headerType} header requires a sample media handle or URL`), { status: 422 });
  }
  const buttons = Array.isArray(payload.buttons) ? payload.buttons : [];
  for (const button of buttons) {
    const type = String(button.type || '').toUpperCase();
    if (type === 'COPY_CODE') {
      if (!String(button.example || '').trim()) throw Object.assign(new Error('Copy Code button requires a sample code'), { status: 422 });
    } else if (!String(button.text || button.label || '').trim()) {
      throw Object.assign(new Error(`${type || 'Template'} button label is required`), { status: 422 });
    }
    if (type === 'URL' && !String(button.url || '').trim()) throw Object.assign(new Error('URL button requires a URL'), { status: 422 });
    if (type === 'PHONE_NUMBER' && !String(button.phone_number || button.phoneNumber || '').trim()) {
      throw Object.assign(new Error('Phone Number button requires a phone number'), { status: 422 });
    }
  }
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
  async uploadSample({ fileName, mimeType, dataBase64 } = {}) {
    if (!fileName || !mimeType || !dataBase64) {
      throw Object.assign(new Error('Sample file name, MIME type, and data are required'), { status: 422 });
    }
    if (!/^(image\/|video\/|application\/pdf$)/.test(mimeType)) {
      throw Object.assign(new Error('Template sample must be an image, video, or PDF document'), { status: 422 });
    }
    const buffer = Buffer.from(String(dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) throw Object.assign(new Error('Uploaded sample media is empty'), { status: 422 });
    if (buffer.length > 16 * 1024 * 1024) throw Object.assign(new Error('Sample media must be 16 MB or smaller'), { status: 413 });

    const safeName = `${Date.now()}-${String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const directory = path.join(__dirname, '..', '..', 'uploads', 'template-samples');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, safeName), buffer);
    const localUrl = `/uploads/template-samples/${safeName}`;

    const settings = await whatsappSettingsService.runtimeConfig();
    if (process.env.WHATSAPP_SEND_ENABLED !== 'true' || !settings.accessToken || !settings.appId) {
      return {
        handle: localUrl,
        localUrl,
        simulated: true,
        message: 'Sample stored locally. Configure Meta App ID/access token and enable sending to obtain a live Meta upload handle.'
      };
    }

    try {
      const session = await axios.post(
        `${settings.apiBaseUrl}/${settings.apiVersion}/${settings.appId}/uploads`,
        null,
        {
          params: { file_name: safeName, file_length: buffer.length, file_type: mimeType },
          headers: { Authorization: `OAuth ${settings.accessToken}` },
          timeout: 20000
        }
      );
      const uploadSessionId = session.data?.id;
      if (!uploadSessionId) throw new Error('Meta did not return an upload session ID');
      const uploaded = await axios.post(
        `${settings.apiBaseUrl}/${settings.apiVersion}/${uploadSessionId}`,
        buffer,
        {
          headers: {
            Authorization: `OAuth ${settings.accessToken}`,
            file_offset: '0',
            'Content-Type': 'application/octet-stream'
          },
          maxBodyLength: Infinity,
          timeout: 60000
        }
      );
      const handle = uploaded.data?.h;
      if (!handle) throw new Error('Meta did not return a sample media handle');
      return { handle, localUrl, simulated: false };
    } catch (error) {
      throw metaApiError(error, 'upload template sample media');
    }
  }

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
    validateTemplatePayload(payload);
    return WhatsAppTemplate.create({
      name: String(payload.name).trim(),
      metaTemplateId: payload.metaTemplateId || null,
      category: payload.category || 'UTILITY',
      language: payload.language || 'en_US',
      headerType: payload.headerType || 'NONE',
      headerContent: payload.headerContent || null,
      body: payload.body,
      footer: payload.footer || null,
      buttons: Array.isArray(payload.buttons) ? payload.buttons : [],
      variables: Array.isArray(payload.variables) ? payload.variables : [],
      status: 'DRAFT',
      qualityRating: 'UNKNOWN'
    });
  }

  async update(id, payload) {
    const row = await this.get(id);
    const next = { ...row.toJSON(), ...payload };
    validateTemplatePayload(next);
    const allowed = ['name', 'category', 'language', 'headerType', 'headerContent', 'body', 'footer', 'buttons', 'variables'];
    const updates = Object.fromEntries(allowed.filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
    if (row.status !== 'DRAFT' && row.status !== 'REJECTED') {
      throw Object.assign(new Error('Only draft or rejected templates can be edited'), { status: 409 });
    }
    await row.update(updates);
    return this.get(id);
  }

  async delete(id) {
    const row = await this.get(id);
    await row.destroy();
    return { deleted: true, id };
  }

  async submit(id) {
    const template = await this.get(id);
    validateTemplatePayload(template.toJSON());
    const settings = await whatsappSettingsService.runtimeConfig();
    if (process.env.WHATSAPP_SEND_ENABLED !== 'true' || !settings.accessToken || !settings.businessAccountId) {
      await template.update({ status: 'PENDING', lastSyncedAt: new Date() });
      return { template: await this.get(id), simulated: true, message: 'Template submission simulated. Configure Meta credentials and enable WhatsApp sending for live submission.' };
    }
    if (
      ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(template.headerType)
      && String(template.headerContent || '').startsWith('/uploads/')
    ) {
      throw Object.assign(new Error('Re-upload the sample media after enabling Meta credentials so a live Meta upload handle can be generated'), { status: 422 });
    }

    const url = `${settings.apiBaseUrl}/${settings.apiVersion}/${settings.businessAccountId}/message_templates`;
    let response;
    try {
      response = await axios.post(url, {
        name: template.name,
        category: template.category,
        language: template.language,
        components: componentsFromTemplate(template)
      }, {
        headers: { Authorization: `Bearer ${settings.accessToken}`, 'Content-Type': 'application/json' },
        timeout: 20000
      });
    } catch (error) {
      throw metaApiError(error, 'submit template');
    }

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
    let response;
    try {
      response = await axios.get(url, {
        params: { fields: 'id,name,category,language,status,quality_score,components', limit: 250 },
        headers: { Authorization: `Bearer ${settings.accessToken}` },
        timeout: 20000
      });
    } catch (error) {
      throw metaApiError(error, 'sync templates');
    }

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

  async approvedTemplateByName(name, language = null) {
    if (!name) return null;
    return WhatsAppTemplate.findOne({
      where: {
        name,
        status: 'APPROVED',
        ...(language ? { language } : {})
      }
    });
  }
}

module.exports = new WhatsAppTemplateService();
