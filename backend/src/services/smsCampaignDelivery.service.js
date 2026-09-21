const { SmsCampaignRecipient, SmsCampaign } = require('../models');

const COUNTER_FIELD = {
  queued: 'queuedCount',
  sent: 'sentCount',
  delivered: 'deliveredCount',
  failed: 'failedCount',
  rejected: 'rejectedCount'
};

// The one integration seam between the generic delivery webhook
// (smsWebhook.service.js) and SMS campaigns — called from inside the SAME
// locked transaction, right after the sms_messages row itself is updated.
// There is no second, parallel webhook system for campaigns.
async function onSmsMessageStatusChanged({ smsMessageId, status, timestamp, error }, transaction) {
  if (!smsMessageId) return { updated: false };
  const recipient = await SmsCampaignRecipient.findOne({ where: { smsMessageId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!recipient) return { updated: false };

  const oldStatus = recipient.status;
  if (oldStatus === status) return { updated: false }; // idempotent re-delivery of the same status

  const patch = { status };
  if (status === 'delivered') patch.deliveredAt = timestamp || new Date();
  if (status === 'failed' || status === 'rejected') {
    patch.failedAt = timestamp || new Date();
    if (error) patch.errorMessage = error;
  }
  await recipient.update(patch, { transaction });

  const campaign = await SmsCampaign.findByPk(recipient.campaignId, { transaction, lock: transaction.LOCK.UPDATE });
  if (campaign) {
    const decrementField = COUNTER_FIELD[oldStatus];
    const incrementField = COUNTER_FIELD[status];
    if (decrementField) await campaign.decrement(decrementField, { by: 1, transaction });
    if (incrementField) await campaign.increment(incrementField, { by: 1, transaction });
    await maybeCompleteCampaign(campaign, transaction);
  }

  return { updated: true, recipientId: recipient.id, campaignId: recipient.campaignId };
}

// Also called directly by the worker (not just this webhook cascade) since
// a recipient can terminalize (e.g. a permanent send-time failure) without
// ever reaching the provider far enough to generate a delivery webhook.
async function maybeCompleteCampaign(campaign, transaction) {
  if (['completed', 'cancelled'].includes(campaign.status)) return;
  if (!['queued', 'running'].includes(campaign.status)) return;
  const remaining = await SmsCampaignRecipient.count({
    where: { campaignId: campaign.id, status: ['queued', 'processing'] },
    transaction
  });
  if (remaining === 0) await campaign.update({ status: 'completed', completedAt: new Date() }, { transaction });
}

module.exports = { onSmsMessageStatusChanged, maybeCompleteCampaign };
