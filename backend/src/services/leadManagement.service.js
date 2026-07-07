const contactService = require('./contact.service');
const leadService = require('./lead.service');
const assignmentService = require('./assignment.service');
const conversationService = require('./conversation.service');
const followupService = require('./followup.service');
const notificationService = require('./notification.service');

class LeadManagementService {
  async processIncomingWhatsapp({ from, whatsappId, profileName, text, threadId, payload, whatsappAccountId = null }) {
    const contact = await contactService.findOrCreateFromWhatsapp({
      phone: from,
      whatsappId,
      firstName: profileName || null,
      lastName: null,
      whatsappAccountId
    });

    let lead = await leadService.getOpenLeadForContact(contact.id, whatsappAccountId);
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

    let assignee = null;
    let assignment = null;
    try {
      const assignmentResult = await assignmentService.assignLead(lead.id);
      assignee = assignmentResult?.assignee || null;
      assignment = assignmentResult?.assignment || null;
    } catch (error) {
      console.error(error);
      console.error(error.message);
      console.error(error.stack);
      if (Array.isArray(error.errors)) {
        console.error('Lead assignment validation errors:', error.errors);
      }
    }

    const conversation = await conversationService.upsertConversation({
      contactId: contact.id,
      leadId: lead.id,
      whatsappThreadId: threadId,
      assignedTo: assignee?.id || null,
      lastMessageAt: new Date(),
      whatsappAccountId
    });

    let followup = null;
    if (assignee) {
      try {
        followup = await followupService.createFollowup({
          leadId: lead.id,
          contactId: contact.id,
          assignedTo: assignee.id,
          dueDate: new Date(Date.now() + 1000 * 60 * 60),
          note: 'Follow up with lead after WhatsApp inquiry',
          priority: 'high'
        });
      } catch (error) {
        console.error(error);
        console.error(error.message);
        console.error(error.stack);
        if (Array.isArray(error.errors)) {
          console.error('Follow-up validation errors:', error.errors);
        }
      }
    }

    if (assignee) {
      try {
        await notificationService.notifyAgentAssignment(assignee, lead, contact);
      } catch (error) {
        console.error(error);
        console.error(error.message);
        console.error(error.stack);
        if (Array.isArray(error.errors)) {
          console.error('Agent notification validation errors:', error.errors);
        }
      }
    }

    return {
      contact,
      lead,
      assignee,
      assignment,
      conversation,
      followup
    };
  }
}

module.exports = new LeadManagementService();
