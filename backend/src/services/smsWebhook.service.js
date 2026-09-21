const { SmsMessage, sequelize } = require('../models');
const logger = require('../config/logger');
const smsCampaignDeliveryService = require('./smsCampaignDelivery.service');

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

// A provider's event timestamp is untrusted input: it may be missing,
// malformed, or (for a redelivered/out-of-order event) simply not the
// ordering signal we should trust. It is used ONLY to populate
// deliveredAt/failedAt for display — it never drives the out-of-order
// decision above (that's rank-based, on the status itself), so a garbage
// timestamp cannot corrupt ordering logic, only the informational
// delivered/failed-at value, which this guards separately.
function resolveEventTimestamp(rawTimestamp) {
  if (rawTimestamp) {
    const parsed = new Date(rawTimestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

// Applies a normalized delivery event (see provider baseProvider.js contract)
// to the matching sms_messages row. Provider-neutral: takes only the
// generic { provider, providerMessageId, recipient, status, error,
// timestamp, metadata } shape — no provider adapter is imported here.
//
// Wrapped in a transaction with a row lock (SELECT ... FOR UPDATE, via
// Sequelize's transaction.LOCK.UPDATE — same pattern as
// aiProvider.service.js's identity check) so two webhook deliveries for the
// SAME message that are genuinely processed concurrently (not exact
// duplicates — the idempotency ledger already short-circuits those before
// this function is ever called) can't race past each other's read-then-write
// and bypass the out-of-order guard.
async function applyDeliveryEvent(event) {
  const provider = event?.provider || null;
  const providerMessageId = event?.providerMessageId || null;

  if (!provider || !providerMessageId) {
    logger.warn('sms_webhook_missing_provider_message_id', { provider });
    return { matched: false, applied: false, reason: 'missing_provider_message_id' };
  }

  return sequelize.transaction(async (transaction) => {
    // provider + providerMessageId together, ANDed by Sequelize's default
    // where-object semantics — never provider OR providerMessageId, which
    // would risk matching another provider's message that happens to reuse
    // the same id string.
    const record = await SmsMessage.findOne({
      where: { provider, providerMessageId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
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

    const timestamp = resolveEventTimestamp(event.timestamp);
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

    await record.update(patch, { transaction });
    logger.info('sms_webhook_status_applied', { provider, providerMessageId, status: incomingStatus, recordId: record.id });

    // If this sms_messages row belongs to a campaign recipient, cascade the
    // status into sms_campaign_recipients + the campaign's aggregate
    // counters in the same transaction — this is the only place that
    // happens; there is no second, campaign-specific webhook system.
    await smsCampaignDeliveryService.onSmsMessageStatusChanged(
      { smsMessageId: record.id, status: incomingStatus, timestamp, error: event.error || null },
      transaction
    );

    return { matched: true, applied: true, recordId: record.id };
  });
}

module.exports = { applyDeliveryEvent, normalizeStatus, STATUS_RANK, TERMINAL_STATUSES };
