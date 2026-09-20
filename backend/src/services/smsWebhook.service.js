const { SmsMessage } = require('../models');
const logger = require('../config/logger');

// Canonical lifecycle. Higher rank = further along / more final. 'delivered'
// is the only state treated as strictly terminal below — once reached, no
// later event (of any rank) may downgrade it, since a provider redelivering
// a stale intermediate status after the message was already confirmed
// delivered must never regress the record.
const STATUS_RANK = { queued: 0, sent: 1, unknown: 1, rejected: 2, failed: 2, delivered: 3 };
const TERMINAL_STATUSES = new Set(['delivered']);
const NORMALIZED_STATUSES = new Set(Object.keys(STATUS_RANK));

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();
  return NORMALIZED_STATUSES.has(value) ? value : 'unknown';
}

// Applies a normalized delivery event (see provider baseProvider.js contract)
// to the matching sms_messages row. Provider-neutral: takes only the
// generic { provider, providerMessageId, recipient, status, error,
// timestamp, metadata } shape — no provider adapter is imported here.
async function applyDeliveryEvent(event) {
  const provider = event?.provider || null;
  const providerMessageId = event?.providerMessageId || null;

  if (!provider || !providerMessageId) {
    logger.warn('sms_webhook_missing_provider_message_id', { provider });
    return { matched: false, applied: false, reason: 'missing_provider_message_id' };
  }

  const record = await SmsMessage.findOne({ where: { provider, providerMessageId } });
  if (!record) {
    logger.warn('sms_webhook_unmatched_provider_message_id', { provider, providerMessageId });
    return { matched: false, applied: false, reason: 'no_matching_sms_message' };
  }

  const incomingStatus = normalizeStatus(event.status);
  const currentStatus = normalizeStatus(record.status);
  const currentRank = STATUS_RANK[currentStatus] ?? -1;
  const incomingRank = STATUS_RANK[incomingStatus] ?? -1;

  if (TERMINAL_STATUSES.has(currentStatus) && incomingStatus !== currentStatus) {
    logger.info('sms_webhook_out_of_order_ignored', {
      provider, providerMessageId, currentStatus, incomingStatus, reason: 'terminal_status_protected'
    });
    return { matched: true, applied: false, reason: 'terminal_status_protected', recordId: record.id };
  }

  if (incomingRank < currentRank) {
    logger.info('sms_webhook_out_of_order_ignored', {
      provider, providerMessageId, currentStatus, incomingStatus, reason: 'lower_rank'
    });
    return { matched: true, applied: false, reason: 'out_of_order', recordId: record.id };
  }

  const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
  const patch = {
    status: incomingStatus,
    providerStatus: event.metadata?.rawStatus || null,
    providerMetadata: event.metadata || null
  };
  if (incomingStatus === 'delivered') patch.deliveredAt = timestamp;
  if (incomingStatus === 'failed' || incomingStatus === 'rejected') {
    patch.failedAt = timestamp;
    if (event.error) patch.errorMessage = event.error;
  }

  await record.update(patch);
  logger.info('sms_webhook_status_applied', { provider, providerMessageId, status: incomingStatus, recordId: record.id });
  return { matched: true, applied: true, recordId: record.id };
}

module.exports = { applyDeliveryEvent, normalizeStatus, STATUS_RANK, TERMINAL_STATUSES };
