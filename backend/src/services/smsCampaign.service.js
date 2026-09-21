const { Op } = require('sequelize');
const { sequelize, SmsCampaign, SmsCampaignRecipient, User } = require('../models');
const audienceService = require('./smsCampaignAudience.service');
const settingsService = require('./smsGatewaySettings.service');
const { interpolateTemplate } = require('../utils/templateInterpolation');
const { estimateSegments } = require('../utils/smsSegment');
const auditService = require('./audit.service');

const ACTIVE_STATUSES = ['queued', 'running'];
const EDITABLE_STATUSES = ['draft', 'scheduled'];
const LAUNCHABLE_STATUSES = ['draft', 'scheduled', 'failed'];
const PREVIEW_SAMPLE_SIZE = 10;
const RECIPIENT_PAGE_MAX = 100;

function notFound(id) {
  return Object.assign(new Error('SMS campaign not found.'), { status: 404, code: 'SMS_CAMPAIGN_NOT_FOUND' });
}

// Same {{name}}/{{first_name}}/{{phone}}/{{course}}/{{batch}} variables the
// task asks for, via the generic (channel-neutral) interpolation utility —
// missing optional variables resolve to '' rather than "undefined".
function personalize(message, recipient) {
  const trimmedName = String(recipient.name || '').trim();
  const firstName = trimmedName.split(/\s+/)[0] || '';
  return interpolateTemplate(message, {
    name: trimmedName,
    first_name: firstName,
    phone: recipient.phone || '',
    course: recipient.course || '',
    batch: recipient.batch || ''
  });
}

class SmsCampaignService {
  async list({ page = 1, pageSize = 25, status } = {}) {
    const where = {};
    if (status) where.status = status;
    const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const currentPage = Math.max(Number(page) || 1, 1);
    const { rows, count } = await SmsCampaign.findAndCountAll({
      where, limit, offset: (currentPage - 1) * limit, order: [['created_at', 'DESC']],
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }]
    });
    return { rows, total: count, page: currentPage, pageSize: limit, totalPages: Math.max(Math.ceil(count / limit), 1) };
  }

  async get(id) {
    const campaign = await SmsCampaign.findByPk(id, { include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }] });
    if (!campaign) throw notFound(id);
    return campaign;
  }

  async listRecipients(campaignId, { page = 1, pageSize = 25, status } = {}) {
    await this.get(campaignId);
    const where = { campaignId };
    if (status) where.status = status;
    const limit = Math.min(Math.max(Number(pageSize) || 25, 1), RECIPIENT_PAGE_MAX);
    const currentPage = Math.max(Number(page) || 1, 1);
    const { rows, count } = await SmsCampaignRecipient.findAndCountAll({
      where, limit, offset: (currentPage - 1) * limit, order: [['id', 'ASC']]
    });
    return { rows, total: count, page: currentPage, pageSize: limit, totalPages: Math.max(Math.ceil(count / limit), 1) };
  }

  async create(payload, user) {
    const name = String(payload.name || '').trim();
    const message = String(payload.message || '').trim();
    const errors = {};
    if (!name) errors.name = 'Campaign name is required.';
    if (!message) errors.message = 'Message is required.';
    if (!audienceService.RECIPIENT_SOURCES.includes(payload.recipientSource)) errors.recipientSource = 'Select a valid recipient source.';
    if (Object.keys(errors).length) throw Object.assign(new Error('Validation failed'), { status: 422, code: 'VALIDATION_FAILED', errors });

    const campaign = await SmsCampaign.create({
      name, message, senderMask: payload.senderMask || null,
      recipientSource: payload.recipientSource, audienceConfig: payload.audienceConfig || {},
      status: 'draft', createdBy: user?.id || null
    });
    await auditService.record({ userId: user?.id, action: 'SMS_CAMPAIGN_CREATED', entityType: 'sms_campaign', entityId: String(campaign.id), changes: { name, recipientSource: payload.recipientSource } });
    return campaign;
  }

  async update(id, payload, user) {
    const campaign = await this.get(id);
    if (!EDITABLE_STATUSES.includes(campaign.status)) throw Object.assign(new Error('Only a draft or scheduled campaign can be edited.'), { status: 409, code: 'SMS_CAMPAIGN_NOT_EDITABLE' });
    const updates = {};
    if (payload.name !== undefined) updates.name = String(payload.name).trim();
    if (payload.message !== undefined) updates.message = String(payload.message).trim();
    if (payload.senderMask !== undefined) updates.senderMask = payload.senderMask || null;
    if (payload.recipientSource !== undefined) updates.recipientSource = payload.recipientSource;
    if (payload.audienceConfig !== undefined) updates.audienceConfig = payload.audienceConfig;
    await campaign.update(updates);
    await auditService.record({ userId: user?.id, action: 'SMS_CAMPAIGN_UPDATED', entityType: 'sms_campaign', entityId: String(id), changes: Object.keys(updates) });
    return this.get(id);
  }

  async remove(id, user) {
    const campaign = await this.get(id);
    if (ACTIVE_STATUSES.includes(campaign.status)) throw Object.assign(new Error('A running or queued campaign cannot be deleted.'), { status: 409, code: 'SMS_CAMPAIGN_NOT_DELETABLE' });
    await campaign.destroy();
    await auditService.record({ userId: user?.id, action: 'SMS_CAMPAIGN_DELETED', entityType: 'sms_campaign', entityId: String(id), changes: {} });
    return { id, deleted: true };
  }

  // Read-only: resolves the audience live and estimates segments from a
  // small representative sample rather than personalizing every recipient
  // up front — cheap even for a large audience. Nothing is persisted here.
  async previewAudience({ recipientSource, audienceConfig, message }) {
    const audience = await audienceService.resolve({ recipientSource, audienceConfig });
    const sample = audience.recipients.slice(0, PREVIEW_SAMPLE_SIZE);
    const sampleEstimates = sample.length
      ? sample.map((recipient) => estimateSegments(personalize(message, recipient)))
      : [estimateSegments(message)];
    const encoding = sampleEstimates.some((estimate) => estimate.encoding === 'UCS-2') ? 'UCS-2' : 'GSM-7';
    const segmentsPerRecipient = Math.max(...sampleEstimates.map((estimate) => estimate.segments), 0);

    let providerSnapshot = null;
    let balance = null;
    try {
      const config = await settingsService.getPublicMetadata();
      providerSnapshot = { provider: config.activeProvider, mode: config.providerConfig?.mode || null, defaultMask: config.providerConfig?.defaultMask || null, capabilities: config.capabilities };
      if (config.capabilities?.balance) {
        balance = await settingsService.getBalance().catch(() => null);
      }
    } catch { providerSnapshot = null; }

    return {
      recipients: audience.recipients.slice(0, 50),
      totalValid: audience.totalValid,
      totalInvalid: audience.totalInvalid,
      duplicatesRemoved: audience.duplicatesRemoved,
      invalid: audience.invalid.slice(0, 50),
      segmentEstimate: { encoding, segmentsPerRecipient, estimatedTotalSegments: segmentsPerRecipient * audience.totalValid },
      settings: providerSnapshot,
      balance
    };
  }

  // Persists the resolved audience as sms_campaign_recipients rows. Chunked
  // bulkCreate with ignoreDuplicates (ON CONFLICT DO NOTHING on the unique
  // (campaign_id, phone) index) so this is safe to call more than once for
  // the same campaign without creating duplicate rows.
  async prepareRecipients(campaign) {
    const audience = await audienceService.resolve({ recipientSource: campaign.recipientSource, audienceConfig: campaign.audienceConfig });
    const rows = audience.recipients.map((recipient) => ({
      campaignId: campaign.id,
      contactId: recipient.contactId,
      leadId: recipient.leadId,
      studentId: recipient.studentId,
      phone: recipient.phone,
      recipientName: recipient.name,
      personalizedMessage: personalize(campaign.message, recipient),
      matchedEntities: recipient.matchedEntities,
      status: 'queued',
      queuedAt: new Date()
    }));
    const CHUNK_SIZE = 500;
    for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
      await SmsCampaignRecipient.bulkCreate(rows.slice(offset, offset + CHUNK_SIZE), { ignoreDuplicates: true });
    }
    return { total: rows.length, invalid: audience.invalid, duplicatesRemoved: audience.duplicatesRemoved };
  }

  // Send Now / Schedule. The status flip happens inside a locked
  // transaction FIRST, before any of the (slower) audience resolution work
  // — a second, double-submitted launch call for the same campaign blocks
  // on the row lock, then sees the already-flipped status and is rejected,
  // rather than racing to prepare/launch the campaign twice.
  async launch(id, { scheduledAt = null } = {}, user) {
    const runAt = scheduledAt ? new Date(scheduledAt) : new Date();
    if (Number.isNaN(runAt.getTime())) throw Object.assign(new Error('Invalid schedule date/time.'), { status: 422, code: 'VALIDATION_FAILED' });
    const isFuture = runAt.getTime() > Date.now() + 1000;

    const campaign = await sequelize.transaction(async (transaction) => {
      const row = await SmsCampaign.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw notFound(id);
      if (!LAUNCHABLE_STATUSES.includes(row.status)) {
        throw Object.assign(new Error('This campaign has already been sent or is currently sending.'), { status: 409, code: 'SMS_CAMPAIGN_ALREADY_LAUNCHED' });
      }
      await row.update({ status: isFuture ? 'scheduled' : 'queued', scheduledAt: isFuture ? runAt : row.scheduledAt }, { transaction });
      return row;
    });

    try {
      const config = await settingsService.getRuntimeConfig();
      if (!config.isEnabled) throw Object.assign(new Error('SMS sending is disabled. Enable it in SMS Gateway settings first.'), { status: 409, code: 'SMS_GATEWAY_DISABLED', exposeMessage: true });

      const existingRecipients = await SmsCampaignRecipient.count({ where: { campaignId: campaign.id } });
      const prepared = existingRecipients
        ? { total: existingRecipients, invalid: [], duplicatesRemoved: 0 }
        : await this.prepareRecipients(campaign);
      const totalRecipients = await SmsCampaignRecipient.count({ where: { campaignId: campaign.id } });
      if (!totalRecipients) throw Object.assign(new Error('No valid recipients matched this campaign.'), { status: 422, code: 'SMS_CAMPAIGN_NO_RECIPIENTS' });

      await campaign.update({
        provider: config.activeProvider,
        mode: config.providerConfig?.mode || null,
        senderMask: campaign.senderMask || config.providerConfig?.defaultMask || null,
        totalRecipients,
        queuedCount: await SmsCampaignRecipient.count({ where: { campaignId: campaign.id, status: 'queued' } }),
        startedAt: isFuture ? campaign.startedAt : (campaign.startedAt || new Date()),
        lastError: null
      });

      await auditService.record({
        userId: user?.id, action: isFuture ? 'SMS_CAMPAIGN_SCHEDULED' : 'SMS_CAMPAIGN_LAUNCHED',
        entityType: 'sms_campaign', entityId: String(campaign.id),
        changes: { scheduledAt: isFuture ? runAt.toISOString() : null, totalRecipients }
      });

      return { campaign: await this.get(id), ...prepared };
    } catch (error) {
      await campaign.update({ status: 'failed', lastError: error.message }).catch(() => {});
      throw error;
    }
  }

  async pause(id, user) {
    const campaign = await this.get(id);
    if (!ACTIVE_STATUSES.includes(campaign.status)) throw Object.assign(new Error('Only a running or queued campaign can be paused.'), { status: 409, code: 'SMS_CAMPAIGN_NOT_PAUSABLE' });
    await campaign.update({ status: 'paused', pausedAt: new Date() });
    await auditService.record({ userId: user?.id, action: 'SMS_CAMPAIGN_PAUSED', entityType: 'sms_campaign', entityId: String(id), changes: {} });
    return this.get(id);
  }

  async resume(id, user) {
    const campaign = await this.get(id);
    if (campaign.status !== 'paused') throw Object.assign(new Error('Only a paused campaign can be resumed.'), { status: 409, code: 'SMS_CAMPAIGN_NOT_RESUMABLE' });
    await campaign.update({ status: 'queued', pausedAt: null });
    await auditService.record({ userId: user?.id, action: 'SMS_CAMPAIGN_RESUMED', entityType: 'sms_campaign', entityId: String(id), changes: {} });
    return this.get(id);
  }

  // Preserves every recipient row (never deletes campaign history) —
  // anything not yet claimed by the worker is marked 'cancelled' so it can
  // never be sent, while anything already in flight finishes untouched.
  async cancel(id, user) {
    const campaign = await this.get(id);
    if (['completed', 'cancelled'].includes(campaign.status)) throw Object.assign(new Error('This campaign is already finished.'), { status: 409, code: 'SMS_CAMPAIGN_NOT_CANCELLABLE' });
    await sequelize.transaction(async (transaction) => {
      await campaign.update({ status: 'cancelled', cancelledAt: new Date() }, { transaction });
      await SmsCampaignRecipient.update(
        { status: 'cancelled' },
        { where: { campaignId: id, status: 'queued' }, transaction }
      );
    });
    await auditService.record({ userId: user?.id, action: 'SMS_CAMPAIGN_CANCELLED', entityType: 'sms_campaign', entityId: String(id), changes: {} });
    return this.get(id);
  }

  // Manual retry: only recipients that failed AND were never actually
  // accepted by the provider (no providerMessageId) AND weren't classified
  // as a permanent failure are eligible — matches "never duplicate
  // recipients already successfully accepted by the provider" and "only
  // transient failures should retry" for the manual path too.
  async retryEligible(id, user) {
    const campaign = await this.get(id);
    if (campaign.status === 'cancelled') throw Object.assign(new Error('A cancelled campaign cannot be retried.'), { status: 409, code: 'SMS_CAMPAIGN_NOT_RETRYABLE' });
    const [requeued] = await SmsCampaignRecipient.update(
      { status: 'queued', attempts: 0, errorMessage: null, isPermanentFailure: null, nextAttemptAt: null, claimedAt: null, workerId: null },
      {
        where: {
          campaignId: id, status: 'failed', providerMessageId: null,
          [Op.or]: [{ isPermanentFailure: false }, { isPermanentFailure: null }]
        }
      }
    );
    if (requeued && !ACTIVE_STATUSES.includes(campaign.status)) await campaign.update({ status: 'queued', lastError: null });
    await auditService.record({ userId: user?.id, action: 'SMS_CAMPAIGN_RETRY_REQUESTED', entityType: 'sms_campaign', entityId: String(id), changes: { requeued } });
    return { requeued };
  }
}

module.exports = new SmsCampaignService();
module.exports.personalize = personalize;
