const logger = require('../config/logger');
const { AppSetting } = require('../models');
const auditService = require('./audit.service');
const whatsappService = require('./whatsapp.service');
const outboundHistoryService = require('./outboundHistory.service');
const notificationTemplateService = require('./notificationTemplate.service');
const { normalizePhone: normalizeWhatsAppNumber } = require('../utils/phone');

function targetPhone(user) {
  return user?.whatsapp || user?.whatsappId || user?.mobile || user?.phone || '';
}

function displayName(person, fallback = 'Unknown') {
  if (!person) return fallback;
  return [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || fallback;
}

class AssignmentNotificationService {
  async globallyEnabled() {
    const setting = await AppSetting.findOne({
      where: { namespace: 'notifications', key: 'assignments' }
    });
    return setting?.value?.assignmentNotificationsEnabled !== false;
  }

  async record({ assignedBy, conversation, recipient, status, reason, error = null }) {
    await auditService.record({
      userId: assignedBy?.id || null,
      action: `conversation.assignment_whatsapp.${status}`,
      entityType: 'conversation',
      entityId: conversation.id,
      method: 'POST',
      path: `/api/conversations/${conversation.id}/assign`,
      changes: {
        recipientUserId: recipient?.id || null,
        to: normalizeWhatsAppNumber(targetPhone(recipient)) || null,
        reason,
        error: error ? String(error.message || error) : null
      }
    });
  }

  async sendAssignmentNotification({
    conversation,
    assignedUser,
    department,
    assignedBy,
    assignedUserChanged = false,
    departmentChanged = false,
    notifyAssignedUser = true
  }) {
    if (!await this.globallyEnabled()) return { sent: 0, skipped: 'globally_disabled' };

    const recipients = new Map();
    if (assignedUserChanged && notifyAssignedUser && assignedUser) {
      recipients.set(String(assignedUser.id), { user: assignedUser, reason: 'direct_assignment' });
    }
    if (departmentChanged && department?.receiveDepartmentAssignmentNotifications) {
      const users = await department.getUsers({
        where: { status: 'active', receiveAssignmentNotifications: true },
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone', 'receiveAssignmentNotifications']
      });
      users.forEach((user) => {
        if (!recipients.has(String(user.id))) recipients.set(String(user.id), { user, reason: 'department_assignment' });
      });
    }

    let sent = 0;
    for (const { user, reason } of recipients.values()) {
      if (user.receiveAssignmentNotifications === false) {
        await this.record({ assignedBy, conversation, recipient: user, status: 'skipped', reason: 'user_disabled' });
        continue;
      }
      const to = normalizeWhatsAppNumber(targetPhone(user));
      if (!to) {
        logger.warn('assignment_whatsapp_notification_failed', {
          conversationId: conversation.id, assignedUserId: user.id,
          agentPhone: targetPhone(user) || null, normalizedTargetPhone: null,
          errorCode: 'AGENT_PHONE_MISSING', errorMessage: 'Assigned user has no valid Sri Lankan phone number'
        });
        await this.record({ assignedBy, conversation, recipient: user, status: 'skipped', reason: 'AGENT_PHONE_MISSING' });
        continue;
      }

      const contact = conversation.contact || {};
      const fallbackText = `Hi ${displayName(user, 'Agent')}, a new customer conversation has been assigned to you. Please check the CRM.`;
      const configuredText = await notificationTemplateService.renderTemplate('assignment_notification', {
        student: {
          name: displayName(contact, 'Customer'),
          phone: contact.phone || contact.whatsappId || ''
        },
        batch: { name: department?.name || '' },
        agent: { name: displayName(user, 'Agent') }
      }).catch(() => null);
      const text = configuredText || fallbackText;

      try {
        logger.info('assignment_whatsapp_notification_attempt', {
          assignedUserId: user.id,
          conversationId: conversation.id,
          agentPhone: targetPhone(user), normalizedTargetPhone: to
        });
        const response = await whatsappService.sendTextMessage({ to, text, log: false, whatsappAccountId: conversation.whatsappAccountId || null });
        sent += 1;
        logger.info('assignment_whatsapp_notification_sent', {
          assignedUserId: user.id,
          conversationId: conversation.id,
          agentPhone: targetPhone(user), normalizedTargetPhone: to,
          whatsappMessageId: response?.id || response?.messages?.[0]?.id || null
        });
        await outboundHistoryService.record({
          conversationId: conversation.id,
          contactId: conversation.contactId,
          leadId: conversation.leadId,
          phone: to,
          sentByUserId: assignedBy?.id || null,
          whatsappMessageId: response?.id || response?.messages?.[0]?.id || null,
          type: 'text',
          messageType: 'assignment_notification',
          text,
          status: 'sent',
          whatsappAccountId: conversation.whatsappAccountId || null,
          isInternalNotification: true,
          sentToUserId: user.id,
          sentToUserName: displayName(user, 'agent'),
          sentToPhone: to,
          rawPayload: {
            source: 'assignment_notification',
            reason,
            assignedUserName: displayName(user, 'agent'),
            whatsapp: response
          }
        });
        await this.record({ assignedBy, conversation, recipient: user, status: 'sent', reason });
      } catch (error) {
        const metaError = error.response?.data?.error || error.metaError?.error || error.metaError || null;
        logger.warn('assignment_whatsapp_notification_failed', {
          assignedUserId: user.id,
          conversationId: conversation.id,
          agentPhone: targetPhone(user), normalizedTargetPhone: to,
          errorCode: metaError?.code == null ? null : String(metaError.code),
          errorMessage: metaError?.message || error.message
        });
        await this.record({ assignedBy, conversation, recipient: user, status: 'failed', reason, error });
      }
    }
    return { sent, attempted: recipients.size };
  }
}

module.exports = new AssignmentNotificationService();
