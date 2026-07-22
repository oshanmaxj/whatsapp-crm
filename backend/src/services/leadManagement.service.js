const leadService = require('./lead.service');
const whatsappLeadRoutingService = require('./whatsappLeadRouting.service');
const followupService = require('./followup.service');
const notificationService = require('./notification.service');
const conversationIdentityService = require('./conversationIdentity.service');
const logger = require('../config/logger');

class LeadManagementService {
  async processIncomingWhatsapp({ from, whatsappId, profileName, text, threadId, payload, whatsappAccountId = null, sourceMessageId = null, persistInbound = null }) {
    const identity = await conversationIdentityService.findOrCreateByPhoneAndAccount({
      phone: from,
      whatsappId,
      firstName: profileName || null,
      lastName: null,
      whatsappAccountId,
      whatsappThreadId: threadId,
      lastMessageAt: new Date(),
      contactStatus: 'new',
      afterResolve: persistInbound
    });
    return {
      contact: identity.contact,
      lead: null,
      assignee: null,
      assignment: null,
      conversation: identity.conversation,
      followup: null,
      message: identity.persisted || null,
      contactResolution: identity.contactResolution || null,
      enrich: () => this.enrichIncomingWhatsapp({ identity, whatsappAccountId, sourceMessageId })
    };
  }

  async enrichIncomingWhatsapp({ identity, whatsappAccountId = null, sourceMessageId = null }) {
    const contact = identity.contact;
    let conversation = identity.conversation;

    let lead = null;
    try {
      lead = await leadService.getOpenLeadForContact(contact.id, whatsappAccountId);
      if (!lead) {
        lead = await leadService.createLead(contact.id, {
          source: 'WhatsApp',
          status: 'new',
          stage: 'new',
          priority: 'medium',
          nextFollowupAt: new Date(Date.now() + 1000 * 60 * 60),
          whatsappAccountId
        });
      }
    } catch (error) {
      logger.warn('whatsapp_inbound_lead_processing_failed', { contactId: contact.id, code: error.code || null, message: error.message });
    }

    let assignee = null;
    let assignment = null;
    try {
      if (!lead) throw Object.assign(new Error('Lead was not available for assignment'), { code: 'INBOUND_LEAD_UNAVAILABLE' });
      const routing = await whatsappLeadRoutingService.routeInboundLead({
        whatsappAccountId, conversationId: conversation.id, contactId: contact.id,
        leadId: lead.id, sourceMessageId
      });
      assignee = routing?.selectedAgent || null;
      assignment = routing || null;
    } catch (error) {
      logger.warn('whatsapp_inbound_assignment_failed', { contactId: contact.id, leadId: lead?.id || null, code: error.code || null, message: error.message });
    }

    if (lead) {
      conversation = await conversation.update({
        leadId: conversation.leadId || lead.id,
        assignedUserId: assignee?.agentId ?? assignee?.id ?? conversation.assignedUserId,
        lastMessageAt: new Date()
      }).catch((error) => {
        logger.warn('whatsapp_inbound_conversation_enrichment_failed', { contactId: contact.id, leadId: lead.id, conversationId: conversation?.id || null, message: error.message });
        return conversation;
      });
    }

    let followup = null;
    if (assignee) {
      try {
        followup = await followupService.createFollowup({
          leadId: lead.id,
          contactId: contact.id,
          assignedTo: assignee.agentId || assignee.id,
          dueDate: new Date(Date.now() + 1000 * 60 * 60),
          note: 'Follow up with lead after WhatsApp inquiry',
          priority: 'high'
        });
      } catch (error) {
        logger.warn('whatsapp_inbound_followup_failed', { contactId: contact.id, leadId: lead?.id || null, message: error.message });
      }
    }

    if (assignee) {
      try {
        const assigneeId = assignee.agentId || assignee.id;
        await notificationService.create({ userId: assigneeId, type: 'lead_assignment', title: 'New WhatsApp lead assigned', message: 'A new WhatsApp lead has been routed to you.', data: { leadId: lead.id, contactId: contact.id, conversationId: conversation.id, whatsappAccountId } });
      } catch (error) {
        logger.warn('whatsapp_inbound_assignment_notification_failed', { contactId: contact.id, leadId: lead?.id || null, message: error.message });
      }
    }

    return {
      contact,
      lead,
      assignee,
      assignment,
      conversation,
      followup,
      message: identity.persisted || null,
      contactResolution: identity.contactResolution || null,
      enrich: null
    };
  }
}

module.exports = new LeadManagementService();
