const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { FacebookPage } = require('../models');
const facebookPageAccessService = require('./facebookPageAccess.service');
const logger = require('../config/logger');

const GRAPH_API_BASE_URL = 'https://graph.facebook.com';

function graphApiVersion() {
  return process.env.FACEBOOK_GRAPH_API_VERSION || 'v21.0';
}

function encryptionKey() {
  const source = process.env.APP_SETTINGS_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || '';
  return crypto.createHash('sha256').update(source).digest();
}

function encrypt(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(value) {
  if (!value || !String(value).startsWith('enc:')) return value || '';
  const [, iv, tag, encrypted] = String(value).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function serialize(row) {
  const data = row?.toJSON ? row.toJSON() : row;
  if (!data) return null;
  delete data.pageAccessTokenEncrypted;
  return {
    ...data,
    accessTokenConfigured: Boolean(row.pageAccessTokenEncrypted)
  };
}

function validatePageFields(payload, { requireToken = false } = {}) {
  if (!clean(payload.name)) throw Object.assign(new Error('Page name is required.'), { status: 400, code: 'FACEBOOK_PAGE_CONFIGURATION_INVALID' });
  if (!clean(payload.pageId)) throw Object.assign(new Error('Facebook Page ID is required.'), { status: 400, code: 'FACEBOOK_PAGE_CONFIGURATION_INVALID' });
  if (requireToken && !clean(payload.pageAccessToken)) {
    throw Object.assign(new Error('Page access token is required.'), { status: 400, code: 'FACEBOOK_PAGE_CONFIGURATION_INVALID' });
  }
}

function graphFailure(error, fallback) {
  const meta = error.response?.data?.error || {};
  return Object.assign(new Error(meta.message || fallback), {
    status: error.response?.status === 401 ? 401 : 502,
    code: 'FACEBOOK_GRAPH_REQUEST_FAILED',
    metaCode: meta.code == null ? null : String(meta.code),
    exposeMessage: true
  });
}

class FacebookPageService {
  async graphRequest(config, method, objectId, edge = '', params = undefined, data = undefined) {
    return axios.request({
      method,
      url: `${GRAPH_API_BASE_URL}/${graphApiVersion()}/${objectId}${edge}`,
      params: { access_token: config.pageAccessToken, ...(params || {}) },
      ...(data === undefined ? {} : { data }),
      timeout: 15000
    });
  }

  async list({ includeInactive = false, userId = null } = {}) {
    const accessWhere = userId ? await facebookPageAccessService.whereForUser(userId, 'id') : {};
    const rows = await FacebookPage.findAll({
      where: { ...(includeInactive ? {} : { active: true }), ...accessWhere },
      order: [['name', 'ASC']]
    });
    return rows.map((row) => serialize(row));
  }

  async get(id) {
    const row = await FacebookPage.findByPk(id);
    if (!row) throw Object.assign(new Error('Facebook Page not found'), { status: 404 });
    return row;
  }

  async getPublic(id, userId = null) {
    if (userId) await facebookPageAccessService.assertAccess(id, userId);
    return serialize(await this.get(id));
  }

  async runtimeConfig(id, userId = null) {
    if (userId) await facebookPageAccessService.assertAccess(id, userId);
    const row = await this.get(id);
    if (!row.active) {
      throw Object.assign(new Error(`${row.name} is inactive. Reactivate this Page before sending or replying.`), {
        status: 409,
        code: 'FACEBOOK_PAGE_INACTIVE'
      });
    }
    return {
      facebookPageId: row.id,
      pageId: clean(row.pageId),
      name: row.name,
      pageAccessToken: clean(decrypt(row.pageAccessTokenEncrypted)),
      appId: row.appId,
      active: row.active,
      sendEnabled: row.sendEnabled !== false
    };
  }

  async create(payload, userId) {
    validatePageFields(payload, { requireToken: true });
    const pageId = clean(payload.pageId);
    const duplicate = await FacebookPage.findOne({ where: { pageId } });
    if (duplicate) throw Object.assign(new Error('This Facebook Page is already connected'), { status: 409, code: 'FACEBOOK_PAGE_EXISTS' });
    const row = await FacebookPage.create({
      name: clean(payload.name),
      pageId,
      pageAccessTokenEncrypted: encrypt(payload.pageAccessToken),
      appId: payload.appId ? clean(payload.appId) : null,
      active: true,
      webhookSubscribed: false,
      sendEnabled: payload.sendEnabled !== false,
      createdBy: userId || null
    });
    return serialize(row);
  }

  async update(id, payload, userId = null) {
    if (userId) await facebookPageAccessService.assertAccess(id, userId);
    validatePageFields({ name: payload.name ?? 'x', pageId: payload.pageId ?? 'x' });
    const row = await this.get(id);
    if (payload.pageId && payload.pageId !== row.pageId) {
      const duplicate = await FacebookPage.findOne({ where: { pageId: payload.pageId, id: { [Op.ne]: row.id } } });
      if (duplicate) throw Object.assign(new Error('This Facebook Page is already connected'), { status: 409, code: 'FACEBOOK_PAGE_EXISTS' });
    }
    await row.update({
      name: payload.name ?? row.name,
      pageId: payload.pageId ?? row.pageId,
      pageAccessTokenEncrypted: payload.pageAccessToken ? encrypt(payload.pageAccessToken) : row.pageAccessTokenEncrypted,
      appId: payload.appId !== undefined ? (clean(payload.appId) || null) : row.appId,
      sendEnabled: payload.sendEnabled !== undefined ? payload.sendEnabled !== false : row.sendEnabled
    });
    return serialize(row);
  }

  async deactivate(id, userId = null) {
    if (userId) await facebookPageAccessService.assertAccess(id, userId);
    const row = await this.get(id);
    await row.update({ active: false, sendEnabled: false, webhookSubscribed: false });
    logger.info('facebook_page_deactivated', { facebookPageId: row.id });
    return serialize(row);
  }

  async verifyConnection(id, userId = null) {
    const config = await this.runtimeConfig(id, userId);
    try {
      const response = await this.graphRequest(config, 'get', config.pageId, '', { fields: 'id,name' });
      const verified = clean(response.data?.id) === config.pageId;
      logger.info('facebook_page_verified', { facebookPageId: config.facebookPageId, verified });
      return { verified, name: response.data?.name || null };
    } catch (error) {
      throw graphFailure(error, 'Unable to verify the Facebook Page connection.');
    }
  }

  async subscribeWebhook(id, userId = null) {
    const config = await this.runtimeConfig(id, userId);
    try {
      await this.graphRequest(config, 'post', config.pageId, '/subscribed_apps', undefined, {
        subscribed_fields: 'messages,messaging_postbacks,feed'
      });
    } catch (error) {
      throw graphFailure(error, 'Unable to subscribe this Page to webhook events.');
    }
    let subscribed = false;
    try {
      const response = await this.graphRequest(config, 'get', config.pageId, '/subscribed_apps');
      subscribed = Array.isArray(response.data?.data) && response.data.data.length > 0;
    } catch (error) {
      subscribed = false;
    }
    await FacebookPage.update({ webhookSubscribed: subscribed }, { where: { id: config.facebookPageId } });
    logger.info('facebook_page_webhook_subscribed', { facebookPageId: config.facebookPageId, subscribed });
    return { subscribed };
  }
}

module.exports = new FacebookPageService();
module.exports.encrypt = encrypt;
module.exports.decrypt = decrypt;
module.exports.serialize = serialize;
