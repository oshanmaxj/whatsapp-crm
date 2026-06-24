const { Followup } = require('../models');

class FollowupService {
  async createFollowup({ leadId, contactId, assignedTo, dueDate, note, priority = 'medium' }) {
    return Followup.create({
      leadId,
      contactId,
      assignedTo,
      dueDate,
      note,
      priority,
      status: 'pending'
    });
  }
}

module.exports = new FollowupService();