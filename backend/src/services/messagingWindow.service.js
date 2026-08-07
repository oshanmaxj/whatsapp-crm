const { Message, Conversation, WhatsAppTemplate } = require('../models');

const WINDOW_MS = 24 * 60 * 60 * 1000;

function calculateMessagingWindow(openedAt, now = new Date()) {
  if (!openedAt) return { isOpen: false, openedAt: null, expiresAt: null, remainingSeconds: 0, reason: 'NO_INBOUND_CUSTOMER_MESSAGE' };
  const opened = new Date(openedAt);
  const expires = new Date(opened.getTime() + WINDOW_MS);
  const remainingSeconds = Math.max(0, Math.ceil((expires.getTime() - new Date(now).getTime()) / 1000));
  return {
    isOpen: new Date(now).getTime() < expires.getTime(),
    openedAt: opened.toISOString(),
    expiresAt: expires.toISOString(),
    remainingSeconds,
    reason: 'CUSTOMER_SERVICE_WINDOW'
  };
}

class MessagingWindowService {
  async getMessagingWindow(conversationId, whatsappAccountId, { transaction = null, now = new Date() } = {}) {
    if (!conversationId || !whatsappAccountId) throw Object.assign(new Error('Conversation and WhatsApp account are required.'), { status: 422, code: 'WHATSAPP_ACCOUNT_MISMATCH' });
    const conversation = await Conversation.findByPk(conversationId, { attributes: ['id', 'whatsappAccountId'], transaction });
    if (!conversation) throw Object.assign(new Error('Conversation not found.'), { status: 404, code: 'CONVERSATION_NOT_FOUND' });
    if (String(conversation.whatsappAccountId) !== String(whatsappAccountId)) throw Object.assign(new Error('Conversation belongs to a different WhatsApp account.'), { status: 409, code: 'WHATSAPP_ACCOUNT_MISMATCH' });
    const inbound = await Message.findOne({
      where: { conversationId, whatsappAccountId, direction: 'inbound' },
      attributes: ['createdAt'], order: [['created_at', 'DESC']], transaction
    });
    return calculateMessagingWindow(inbound?.createdAt, now);
  }

  async authorizeSessionMessage({ conversationId, whatsappAccountId, templateId = null, transaction = null, now = new Date() }) {
    const messagingWindow = await this.getMessagingWindow(conversationId, whatsappAccountId, { transaction, now });
    if (messagingWindow.isOpen) return { allowed: true, messagingWindow, template: null };
    if (!templateId) {
      const code = messagingWindow.reason === 'NO_INBOUND_CUSTOMER_MESSAGE' ? 'NO_INBOUND_CUSTOMER_MESSAGE' : 'MESSAGING_WINDOW_CLOSED';
      throw Object.assign(new Error('The WhatsApp 24-hour messaging window is closed. An approved template is required.'), { status: 409, code, messagingWindow });
    }
    const template = await WhatsAppTemplate.findByPk(templateId, { transaction });
    if (!template || template.status !== 'APPROVED' || String(template.whatsappAccountId) !== String(whatsappAccountId)) {
      throw Object.assign(new Error('An approved template for this WhatsApp account is required.'), { status: 422, code: 'APPROVED_TEMPLATE_REQUIRED', messagingWindow });
    }
    return { allowed: true, messagingWindow, template };
  }
}

module.exports = new MessagingWindowService();
module.exports.calculateMessagingWindow = calculateMessagingWindow;
module.exports.WINDOW_MS = WINDOW_MS;
