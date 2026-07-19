const { Op } = require('sequelize');
const { Campaign, CampaignEvent, CampaignRecipient, MessageQueue, Notification, StudentAutomationDispatch } = require('../models');
const whatsappService = require('./whatsapp.service');
const outboundHistoryService = require('./outboundHistory.service');
const logger = require('../config/logger');

const RATE_LIMIT_PER_TICK = Number(process.env.QUEUE_RATE_LIMIT_PER_TICK || 5);

function templatePreview(body, components = []) {
  const parameters = components.find((component) => component.type === 'body')?.parameters || [];
  return String(body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index) => {
    const parameter = parameters[Number(index) - 1];
    return parameter?.text == null ? match : String(parameter.text);
  });
}

class MessageQueueService {
  async enqueue(payload, createdBy = null) {
    return MessageQueue.create({
      channel: payload.channel || 'whatsapp',
      messageType: payload.messageType || 'text',
      toNumber: payload.to || payload.toNumber,
      payload: payload.payload || payload,
      priority: payload.priority || 5,
      scheduledAt: payload.scheduledAt || new Date(),
      maxAttempts: payload.maxAttempts || 3,
      campaignId: payload.campaignId || null,
      campaignRecipientId: payload.campaignRecipientId || null,
      whatsappAccountId: payload.whatsappAccountId || payload.payload?.whatsappAccountId || null,
      conversationId: payload.conversationId || payload.payload?.conversationId || null,
      contactId: payload.contactId || payload.payload?.contactId || null,
      createdBy
    });
  }

  async list(query = {}) {
    const where = {};
    if (query.status) where.status = query.status;
    if (query.whatsappAccountId) where.whatsappAccountId = query.whatsappAccountId;
    return MessageQueue.findAll({ where, order: [['priority', 'ASC'], ['scheduled_at', 'ASC']], limit: 200 });
  }

  async stats() {
    const rows = await MessageQueue.findAll({ attributes: ['status'], raw: true });
    return rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
  }

  async processDue(limit = RATE_LIMIT_PER_TICK) {
    const rows = await MessageQueue.findAll({
      where: {
        status: { [Op.in]: ['queued', 'retrying'] },
        scheduledAt: { [Op.lte]: new Date() }
      },
      order: [['priority', 'ASC'], ['scheduled_at', 'ASC']],
      limit
    });

    const results = [];
    for (const row of rows) {
      results.push(await this.processOne(row));
    }
    return results;
  }

  async processOne(row) {
    await row.update({ status: 'processing', attempts: row.attempts + 1 });
    if (row.campaignId) await Campaign.update({ status: 'Processing' }, { where: { id: row.campaignId, status: 'Scheduled' } });
    let preparedHistory = null;
    let deliveredMessageId = null;
    let deliveryResponse = null;
    let deliverySucceeded = false;
    try {
      let queuePayload = row.payload || {};
      const requiresCanonicalHistory = row.channel === 'whatsapp' && (
        queuePayload.automationTemplateKey === 'payment_confirmation'
        || queuePayload.paymentSlipId || queuePayload.paymentReceiptId
      );
      if (requiresCanonicalHistory) {
        preparedHistory = await outboundHistoryService.prepare({
          phone: row.toNumber, name: queuePayload.studentName || null,
          contactId: row.contactId || queuePayload.contactId || null,
          conversationId: row.conversationId || queuePayload.conversationId || null,
          sourceMessageId: queuePayload.sourceMessageId || null,
          paymentSlipId: queuePayload.paymentSlipId || null,
          whatsappAccountId: row.whatsappAccountId || queuePayload.whatsappAccountId || null,
          sentByUserId: row.createdBy || null,
          type: row.messageType === 'document' ? 'document' : 'text',
          messageType: queuePayload.paymentReceiptId ? 'payment_receipt' : (queuePayload.paymentSlipId ? 'payment_slip_acknowledgement' : 'automation'),
          text: queuePayload.text || queuePayload.message || null,
          mediaId: queuePayload.mediaId || null,
          status: 'pending', historyMessageId: queuePayload.historyMessageId || null,
          rawPayload: { source: queuePayload.paymentReceiptId ? 'payment_receipt' : (queuePayload.paymentSlipId ? 'payment_slip' : 'student_automation'), queueId: row.id }
        });
        const canonicalPayload = { ...queuePayload, historyMessageId: preparedHistory.message.id };
        await row.update({
          payload: canonicalPayload, contactId: preparedHistory.contact.id,
          conversationId: preparedHistory.conversation.id,
          whatsappAccountId: preparedHistory.conversation.whatsappAccountId
        });
        row.payload = canonicalPayload;
      }
      const response = await this.dispatch(row, preparedHistory?.conversation?.whatsappAccountId);
      deliverySucceeded = true;
      deliveryResponse = response;
      const externalMessageId = response?.id || response?.messages?.[0]?.id || null;
      deliveredMessageId = externalMessageId;
      await row.update({
        status: 'sent',
        processedAt: new Date(),
        externalMessageId,
        lastError: null
      });
      if (preparedHistory) {
        await outboundHistoryService.complete(preparedHistory, {
          whatsappMessageId: externalMessageId, status: 'sent',
          rawPayload: { ...(preparedHistory.message.rawPayload || {}), whatsapp: response }
        });
      }
      queuePayload = row.payload || {};
      if (queuePayload.automationDispatchId) {
        await StudentAutomationDispatch.update(
          { status: 'sent' },
          { where: { id: queuePayload.automationDispatchId } }
        );
        if (!preparedHistory) await outboundHistoryService.record({
          phone: row.toNumber,
          name: queuePayload.studentName || null,
          contactId: queuePayload.contactId || null,
          leadId: queuePayload.leadId || null,
          sentByUserId: row.createdBy || null,
          whatsappMessageId: externalMessageId,
          type: 'text',
          messageType: 'automation',
          text: queuePayload.text || queuePayload.message || null,
          status: 'sent',
          whatsappAccountId: row.whatsappAccountId || null,
          rawPayload: {
            source: 'student_automation',
            queueId: row.id,
            templateKey: queuePayload.automationTemplateKey,
            whatsapp: response
          }
        });
      } else if (queuePayload.isAutomationTest) {
        await outboundHistoryService.record({
          phone: row.toNumber,
          name: queuePayload.studentName || null,
          contactId: queuePayload.contactId || null,
          sentByUserId: row.createdBy || null,
          whatsappMessageId: externalMessageId,
          type: 'text',
          messageType: 'automation_test',
          text: queuePayload.text || null,
          status: 'sent',
          whatsappAccountId: row.whatsappAccountId || null,
          rawPayload: { source: 'student_automation_test', queueId: row.id }
        });
      }
      if (row.campaignRecipientId) {
        await CampaignRecipient.update({
          status: 'sent',
          sentAt: new Date(),
          externalMessageId,
          errorMessage: null
        }, { where: { id: row.campaignRecipientId } });
        await CampaignEvent.create({
          campaignId: row.campaignId,
          recipientId: row.campaignRecipientId,
          eventType: 'sent',
          payload: { queueId: row.id, externalMessageId }
        });
        try {
          const [campaign, recipient] = await Promise.all([
            Campaign.findByPk(row.campaignId),
            CampaignRecipient.findByPk(row.campaignRecipientId)
          ]);
          const queuePayload = row.payload || {};
          await outboundHistoryService.record({
            phone: recipient?.phone || row.toNumber,
            name: recipient?.name || null,
            contactId: recipient?.contactId || null,
            leadId: recipient?.leadId || null,
            sentByUserId: row.createdBy || campaign?.createdBy || null,
            whatsappMessageId: externalMessageId,
            type: row.messageType === 'template' ? 'template' : 'text',
            messageType: 'broadcast',
            text: row.messageType === 'template'
              ? templatePreview(campaign?.messageBody, queuePayload.components)
              : queuePayload.text || queuePayload.message || campaign?.messageBody || null,
            templateName: queuePayload.templateName || campaign?.templateName || null,
            campaignId: row.campaignId,
            campaignRecipientId: row.campaignRecipientId,
            status: 'sent',
            whatsappAccountId: row.whatsappAccountId || campaign?.whatsappAccountId || null,
            rawPayload: {
              source: 'broadcast',
              queueId: row.id,
              whatsapp: response,
              template: row.messageType === 'template' ? queuePayload : null
            }
          });
        } catch (historyError) {
          logger.warn('broadcast_chat_history_processing_failed', {
            queueId: row.id,
            campaignId: row.campaignId,
            campaignRecipientId: row.campaignRecipientId,
            message: historyError.message
          });
        }
        await this.refreshCampaignStatus(row.campaignId);
      }
      return row;
    } catch (error) {
      if (deliverySucceeded) {
        if (preparedHistory && preparedHistory.message.status !== 'sent') {
          await outboundHistoryService.complete(preparedHistory, {
            whatsappMessageId: deliveredMessageId, status: 'sent',
            rawPayload: { ...(preparedHistory.message.rawPayload || {}), whatsapp: deliveryResponse }
          }).catch((historyError) => logger.error('delivered_payment_message_history_incomplete', {
            queueId: row.id, conversationId: preparedHistory.conversation.id, message: historyError.message
          }));
        }
        await row.update({ status: 'sent', processedAt: new Date(), externalMessageId: deliveredMessageId, lastError: null });
        const deliveredPayload = row.payload || {};
        if (deliveredPayload.automationDispatchId) {
          await StudentAutomationDispatch.update({ status: 'sent' }, { where: { id: deliveredPayload.automationDispatchId } }).catch(() => null);
        }
        return row;
      }
      if (preparedHistory) await outboundHistoryService.fail(preparedHistory, error).catch(() => null);
      const hasAttempts = row.attempts < row.maxAttempts;
      await row.update({
        status: hasAttempts ? 'retrying' : 'failed',
        lastError: error.message,
        nextAttemptAt: hasAttempts ? new Date(Date.now() + row.attempts * 60000) : null,
        scheduledAt: hasAttempts ? new Date(Date.now() + row.attempts * 60000) : row.scheduledAt
      });
      const queuePayload = row.payload || {};
      if (queuePayload.automationDispatchId) {
        await StudentAutomationDispatch.update(
          { status: hasAttempts ? 'retrying' : 'failed' },
          { where: { id: queuePayload.automationDispatchId } }
        );
        await Notification.create({
          type: 'student_automation_failed',
          title: `Student message ${hasAttempts ? 'will retry' : 'failed'}`,
          message: `${queuePayload.automationTemplateKey || 'Automation'} to ${row.toNumber}: ${error.message}`,
          data: { queueId: row.id, dispatchId: queuePayload.automationDispatchId, attempt: row.attempts, willRetry: hasAttempts }
        });
      }
      if (row.campaignRecipientId && !hasAttempts) {
        await CampaignRecipient.update({
          status: 'failed',
          errorMessage: error.message
        }, { where: { id: row.campaignRecipientId } });
        await CampaignEvent.create({
          campaignId: row.campaignId,
          recipientId: row.campaignRecipientId,
          eventType: 'failed',
          payload: { queueId: row.id, error: error.message }
        });
        await this.refreshCampaignStatus(row.campaignId);
      }
      return row;
    }
  }

  async dispatch(row, resolvedWhatsappAccountId = null) {
    const payload = row.payload || {};
    const whatsappAccountId = resolvedWhatsappAccountId || row.whatsappAccountId;
    if (row.channel !== 'whatsapp') return { id: `system-${row.id}` };
    if (row.messageType === 'template') return whatsappService.sendTemplateMessage({ ...payload, whatsappAccountId, log: false });
    if (['image', 'document', 'audio', 'video'].includes(row.messageType)) return whatsappService.sendMediaMessage({ ...payload, whatsappAccountId, mediaType: row.messageType, log: false });
    return whatsappService.sendTextMessage({ to: row.toNumber, text: payload.text || payload.message || '', whatsappAccountId, log: false });
  }

  async refreshCampaignStatus(campaignId) {
    if (!campaignId) return;
    const [remaining, sent, failed] = await Promise.all([
      CampaignRecipient.count({ where: { campaignId, status: { [Op.in]: ['pending', 'queued'] } } }),
      CampaignRecipient.count({ where: { campaignId, status: { [Op.in]: ['sent', 'delivered', 'read', 'replied', 'converted'] } } }),
      CampaignRecipient.count({ where: { campaignId, status: { [Op.in]: ['failed', 'unreachable'] } } })
    ]);
    if (remaining > 0) return;
    await Campaign.update({
      status: sent > 0 ? 'Completed' : (failed > 0 ? 'Failed' : 'Completed'),
      sentAt: new Date()
    }, { where: { id: campaignId } });
  }

  start(intervalMs = Number(process.env.QUEUE_WORKER_INTERVAL_MS || 15000)) {
    if (this.timer) return;
    this.timer = setInterval(() => this.processDue().catch((error) => logger.error('queue_worker_failed', error)), intervalMs);
  }
}

module.exports = new MessageQueueService();
module.exports.MessageQueueService = MessageQueueService;
