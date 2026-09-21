const os = require('os');
const { Op } = require('sequelize');
const { sequelize, SmsCampaign, SmsCampaignRecipient, SmsMessage } = require('../models');
const smsService = require('./sms/sms.service');
const settingsService = require('./smsGatewaySettings.service');
const { maybeCompleteCampaign } = require('./smsCampaignDelivery.service');
const logger = require('../config/logger');

// Deliberately isolated from messageQueue.service.js (WhatsApp's worker) —
// its own polling loop, its own claim query, its own table. Nothing here
// can affect WhatsApp campaign/queue processing, and nothing there can
// affect this. Actual sends go through services/sms/sms.service.js only —
// this file never imports a provider adapter.
const RATE_LIMIT_PER_TICK = Number(process.env.SMS_CAMPAIGN_RATE_LIMIT_PER_TICK || 5);
const LEASE_MS = Math.max(30000, Number(process.env.SMS_CAMPAIGN_PROCESSING_LEASE_MS || 300000));
const WORKER_ID = `${os.hostname()}:${process.pid}:${process.env.NODE_APP_INSTANCE || '0'}`;
const MAX_BACKOFF_MS = 30 * 60000;

// Error codes the generic facade / adapter already classify as permanent —
// this never inspects provider-specific text, only the normalized code the
// adapter attached (e.g. SENDER_MASK_NOT_APPROVED from smsgo.provider.js).
const PERMANENT_ERROR_CODES = new Set([
  'SENDER_MASK_NOT_APPROVED', 'INVALID_PHONE_NUMBER', 'VALIDATION_FAILED',
  'SMS_PROVIDER_NOT_CONFIGURED', 'SMS_GATEWAY_DISABLED', 'SMS_PROVIDER_UNKNOWN'
]);

function classifyFailure(error) {
  if (PERMANENT_ERROR_CODES.has(error.code)) return true;
  const status = Number(error.status || 0);
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return true;
  return false; // network errors, 5xx, 408, 429 => transient
}

class SmsCampaignWorkerService {
  // Flips due 'scheduled' campaigns to 'queued' so the claim loop below
  // picks up their (already-prepared) recipients. Survives restarts by
  // construction — this reads scheduledAt from Postgres, not an in-memory
  // timer, so a missed tick (e.g. during a deploy) is simply caught on the
  // next one.
  async discoverDueScheduledCampaigns() {
    const now = new Date();
    const due = await SmsCampaign.findAll({ where: { status: 'scheduled', scheduledAt: { [Op.lte]: now } }, attributes: ['id'] });
    for (const row of due) {
      await sequelize.transaction(async (transaction) => {
        const campaign = await SmsCampaign.findByPk(row.id, { transaction, lock: transaction.LOCK.UPDATE, skipLocked: true });
        if (!campaign || campaign.status !== 'scheduled') return;
        await campaign.update({ status: 'queued', startedAt: campaign.startedAt || new Date() }, { transaction });
        logger.info('sms_campaign_schedule_due', { campaignId: campaign.id });
      });
    }
  }

  // SELECT ... FOR UPDATE SKIP LOCKED, same idiom as messageQueue.service.js's
  // processDue() — concurrency-safe across multiple app instances, and a
  // lease (claimedAt + LEASE_MS) reclaims a recipient stuck 'processing'
  // from a worker that crashed mid-send, without ever double-sending one
  // that already has a providerMessageId (checked in processRecipient too).
  async claimNextRecipient() {
    const claimableCampaigns = await SmsCampaign.findAll({ where: { status: { [Op.in]: ['queued', 'running'] } }, attributes: ['id'] });
    if (!claimableCampaigns.length) return null;
    const campaignIds = claimableCampaigns.map((row) => row.id);

    return sequelize.transaction(async (transaction) => {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - LEASE_MS);
      const recipient = await SmsCampaignRecipient.findOne({
        where: {
          campaignId: { [Op.in]: campaignIds },
          [Op.or]: [
            { status: { [Op.in]: ['queued', 'retrying'] }, [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: now } }] },
            { status: 'processing', [Op.or]: [{ claimedAt: null }, { claimedAt: { [Op.lt]: staleBefore } }] }
          ]
        },
        order: [['id', 'ASC']],
        transaction, lock: transaction.LOCK.UPDATE, skipLocked: true
      });
      if (!recipient) return null;
      await recipient.update({ status: 'processing', attempts: recipient.attempts + 1, claimedAt: now, workerId: WORKER_ID }, { transaction });
      return recipient;
    });
  }

  async processDue(limit = RATE_LIMIT_PER_TICK) {
    await this.discoverDueScheduledCampaigns().catch((error) => logger.error('sms_campaign_schedule_discovery_failed', { message: error.message }));
    const results = [];
    for (let index = 0; index < limit; index += 1) {
      const recipient = await this.claimNextRecipient();
      if (!recipient) break;
      results.push(await this.processRecipient(recipient));
    }
    return results;
  }

  async processRecipient(recipient) {
    const campaign = await SmsCampaign.findByPk(recipient.campaignId);
    if (!campaign || campaign.status === 'cancelled') {
      await recipient.update({ status: 'cancelled', claimedAt: null, workerId: null });
      return { id: recipient.id, outcome: 'cancelled' };
    }
    if (campaign.status === 'paused') {
      // Shouldn't normally be claimable while paused (excluded from the
      // claimable-campaign list above), but defensive: release the claim
      // rather than send under a paused campaign.
      await recipient.update({ status: 'queued', claimedAt: null, workerId: null });
      return { id: recipient.id, outcome: 'released_paused' };
    }
    if (recipient.providerMessageId) {
      // Already accepted by the provider in a prior attempt — never
      // duplicate a successfully-accepted send.
      await recipient.update({ status: 'sent', claimedAt: null, workerId: null });
      return { id: recipient.id, outcome: 'already_sent' };
    }

    // Sandbox/Live isolation: refuse to silently carry a campaign launched
    // under one mode into a send under a different one if the gateway's
    // active mode changed after launch — pause for an operator to confirm
    // rather than guess.
    let config;
    try {
      config = await settingsService.getRuntimeConfig();
    } catch (error) {
      await this._releaseAndPause(recipient, campaign, `Unable to read SMS gateway settings: ${error.message}`);
      return { id: recipient.id, outcome: 'paused_settings_error' };
    }
    const currentMode = config.providerConfig?.mode || null;
    if (campaign.mode && currentMode && campaign.mode !== currentMode) {
      await this._releaseAndPause(recipient, campaign, `Gateway mode changed since this campaign was launched (launched under "${campaign.mode}", gateway is now "${currentMode}"). Resume after confirming the intended mode.`);
      return { id: recipient.id, outcome: 'paused_mode_mismatch' };
    }

    let result;
    try {
      result = await smsService.sendSms({
        to: recipient.phone,
        message: recipient.personalizedMessage || campaign.message,
        mask: campaign.senderMask || undefined,
        campaignName: campaign.name
      });
    } catch (error) {
      return this._handleSendFailure(recipient, campaign, error);
    }

    // The send itself succeeded — from here on, a failure is bookkeeping,
    // not a send failure, and must NEVER be reinterpreted as one (that
    // would mark an already-provider-accepted recipient for retry). The
    // providerMessageId guard at the top of this method makes a resulting
    // retry harmless either way, but the recipient's own status must still
    // reflect reality.
    try {
      const smsMessageRow = await SmsMessage.create({
        toNumber: recipient.phone,
        message: recipient.personalizedMessage || campaign.message,
        mask: result.mask || campaign.senderMask || null,
        status: 'sent',
        provider: result.provider,
        providerMessageId: result.providerMessageId || null,
        providerStatus: result.providerStatus || null,
        providerMetadata: result.raw || null,
        campaignName: campaign.name,
        source: 'campaign',
        contactId: recipient.contactId,
        leadId: recipient.leadId,
        studentId: recipient.studentId,
        sentAt: new Date()
      });

      await recipient.update({
        status: 'sent', provider: result.provider, providerMessageId: result.providerMessageId || null,
        smsMessageId: smsMessageRow.id, errorMessage: null, isPermanentFailure: null,
        sentAt: new Date(), claimedAt: null, workerId: null
      });
      await this._bumpCounter(campaign.id, 'sentCount');
      logger.info('sms_campaign_recipient_sent', { campaignId: campaign.id, recipientId: recipient.id, provider: result.provider });
      return { id: recipient.id, outcome: 'sent' };
    } catch (bookkeepingError) {
      logger.error('sms_campaign_recipient_bookkeeping_failed', { campaignId: campaign.id, recipientId: recipient.id, message: bookkeepingError.message });
      await recipient.update({
        status: 'sent', provider: result.provider, providerMessageId: result.providerMessageId || null,
        claimedAt: null, workerId: null
      }).catch(() => {});
      return { id: recipient.id, outcome: 'sent', bookkeepingError: bookkeepingError.message };
    }
  }

  async _releaseAndPause(recipient, campaign, message) {
    await recipient.update({ status: 'queued', claimedAt: null, workerId: null });
    if (campaign.status !== 'paused') {
      await campaign.update({ status: 'paused', pausedAt: new Date(), lastError: message });
      logger.warn('sms_campaign_auto_paused', { campaignId: campaign.id, reason: message });
    }
  }

  async _handleSendFailure(recipient, campaign, error) {
    const permanent = classifyFailure(error);
    logger.error('sms_campaign_recipient_send_failed', {
      campaignId: campaign.id, recipientId: recipient.id, code: error.code, permanent, message: error.message
    });

    const smsMessageRow = await SmsMessage.create({
      toNumber: recipient.phone,
      message: recipient.personalizedMessage || campaign.message,
      mask: campaign.senderMask || null,
      status: 'failed',
      provider: error.provider || campaign.provider || null,
      errorMessage: error.technicalMessage || error.message,
      campaignName: campaign.name,
      source: 'campaign',
      contactId: recipient.contactId,
      leadId: recipient.leadId,
      studentId: recipient.studentId,
      failedAt: new Date()
    });

    if (!permanent && recipient.attempts < recipient.maxAttempts) {
      const backoffMs = Math.min(60000 * (2 ** (recipient.attempts - 1)), MAX_BACKOFF_MS);
      await recipient.update({
        status: 'retrying', nextAttemptAt: new Date(Date.now() + backoffMs), claimedAt: null, workerId: null,
        errorMessage: error.message, smsMessageId: smsMessageRow.id, isPermanentFailure: false
      });
      return { id: recipient.id, outcome: 'retrying' };
    }

    await recipient.update({
      status: 'failed', errorMessage: error.message, smsMessageId: smsMessageRow.id,
      isPermanentFailure: permanent, failedAt: new Date(), claimedAt: null, workerId: null
    });
    await this._bumpCounter(campaign.id, 'failedCount');
    return { id: recipient.id, outcome: 'failed', permanent };
  }

  // Best-effort: the recipient row (updated by the caller before this runs)
  // is the source of truth for whether a message was sent — this only
  // maintains the campaign's live aggregate counters/completion state, so
  // a failure here must never throw back into the send/failure path.
  async _bumpCounter(campaignId, field) {
    try {
      const campaign = await SmsCampaign.findByPk(campaignId);
      if (!campaign) return;
      await campaign.increment(field, { by: 1 });
      await campaign.reload();
      await maybeCompleteCampaign(campaign);
    } catch (error) {
      logger.error('sms_campaign_counter_update_failed', { campaignId, field, message: error.message });
    }
  }

  start(intervalMs = Number(process.env.SMS_CAMPAIGN_WORKER_INTERVAL_MS || 15000)) {
    if (this.timer) return;
    logger.info('sms_campaign_worker_started', { workerId: WORKER_ID, intervalMs, leaseMs: LEASE_MS });
    this.processDue().catch((error) => logger.error('sms_campaign_worker_failed', { workerId: WORKER_ID, message: error.message, stack: error.stack }));
    this.timer = setInterval(() => this.processDue().catch((error) => logger.error('sms_campaign_worker_failed', { workerId: WORKER_ID, message: error.message, stack: error.stack })), intervalMs);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

module.exports = new SmsCampaignWorkerService();
module.exports.classifyFailure = classifyFailure;
module.exports.WORKER_ID = WORKER_ID;
