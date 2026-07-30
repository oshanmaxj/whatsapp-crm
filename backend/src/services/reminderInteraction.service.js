const models = require('../models');
const { normalizeButtons } = require('./whatsappButtonConfig.service');

class ReminderInteractionService {
  async resolve(input = {}) {
    if (!input.replyToWhatsappMessageId || !input.buttonPayload || !input.whatsappAccountId) return input;
    const execution = await models.ReminderExecution.findOne({
      where: {
        whatsappMessageId: input.replyToWhatsappMessageId,
        whatsappAccountId: input.whatsappAccountId
      },
      order: [['sent_at', 'DESC']]
    });
    if (!execution) return input;
    const button = normalizeButtons(execution.buttonConfigurationSnapshot)
      .find(item => item.buttonId === String(input.buttonPayload));
    if (!button) return input;
    const metadata = {
      source: 'reminder_button',
      reminderSequenceId: execution.sequenceId,
      reminderStepId: execution.sequenceStepId,
      reminderSubscriptionId: execution.subscriptionId,
      buttonId: button.buttonId,
      buttonTitle: button.title,
      behavior: button.behavior
    };
    if (button.sequenceBehavior !== 'flow_decides' && button.sequenceBehavior !== 'continue') {
      await models.sequelize.transaction(async transaction => {
        const subscription = await models.ReminderSubscription.findByPk(execution.subscriptionId, {
          transaction, lock: transaction.LOCK.UPDATE
        });
        if (!subscription || !['active', 'paused'].includes(subscription.status)) return;
        const values = button.sequenceBehavior === 'pause'
          ? { status: 'paused', nextRunAt: null }
          : button.sequenceBehavior === 'complete'
            ? { status: 'completed', completedAt: new Date(), nextRunAt: null }
            : { status: 'stopped_by_button', cancelledAt: new Date(), nextRunAt: null };
        await subscription.update({
          ...values,
          metadata: { ...(subscription.metadata || {}), stoppedReason: button.sequenceBehavior, stoppedByButtonId: button.buttonId, stoppedAt: new Date().toISOString() }
        }, { transaction });
        await models.ReminderExecution.update({ status: 'cancelled' }, {
          where: { subscriptionId: subscription.id, status: 'scheduled' }, transaction
        });
      });
    }
    return {
      ...input,
      text: button.behavior === 'trigger_keyword' ? button.triggerKeyword : input.text,
      reminderInteraction: metadata,
      rawPayload: { ...(input.rawPayload || {}), reminderInteraction: metadata }
    };
  }
}

module.exports = new ReminderInteractionService();
module.exports.ReminderInteractionService = ReminderInteractionService;
