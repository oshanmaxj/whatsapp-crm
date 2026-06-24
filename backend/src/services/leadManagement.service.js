const contactService = require('./contact.service');
const leadService = require('./lead.service');
const assignmentService = require('./assignment.service');
const conversationService = require('./conversation.service');
const followupService = require('./followup.service');
const notificationService = require('./notification.service');

class LeadManagementService {
  async processIncomingWhatsapp({ from, whatsappId, text, threadId, payload }) {
    const contact = await contactService.findOrCreateFromWhatsapp({
      phone: from,
      whatsappId,
      firstName: payload?.profile?.name || null,
      lastName: null
    });

    let lead = await leadService.getOpenLeadForContact(contact.id);
    if (!lead) {
      lead = await leadService.createLead(contact.id, {
        source: 'WhatsApp',
        status: 'new',
        stage: 'new',
        priority: 'medium',
        nextFollowupAt: new Date(Date.now() + 1000 * 60 * 60)
      });
    }

    const assignmentResult = await assignmentService.assignLead(lead.id);
    const assignee = assignmentResult.assignee;

    const conversation = await conversationService.upsertConversation({
      contactId: contact.id,
      leadId: lead.id,
      whatsappThreadId: threadId,
      assignedTo: assignee.id,
      lastMessageAt: new Date()
    });

    const followup = await followupService.createFollowup({
      leadId: lead.id,
      contactId: contact.id,
      assignedTo: assignee.id,
      dueDate: new Date(Date.now() + 1000 * 60 * 60),
      note: 'Follow up with lead after WhatsApp inquiry',
      priority: 'high'
    });

    await notificationService.notifyAgentAssignment(assignee, lead, contact);

    return {
      contact,
      lead,
      assignee,
      assignment: assignmentResult.assignment,
      conversation,
      followup
    };
  }
}

module.exports = new LeadManagementService();