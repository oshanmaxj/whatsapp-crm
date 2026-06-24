const aiService = require('./ai.service');
const { User, Role } = require('../models');
const LeadAssignment = require('../models').LeadAssignment;

class AssignmentService {
  async getAvailableAgents() {
    const agentRole = await Role.findOne({ where: { name: 'agent' } });
    const query = { status: 'active' };

    if (!agentRole) {
      return User.findAll({ where: query, order: [['id', 'ASC']] });
    }

    return agentRole.getUsers({ where: query, order: [['id', 'ASC']] });
  }

  async getLastAssignment() {
    return LeadAssignment.findOne({
      order: [['assigned_at', 'DESC']]
    });
  }

  async chooseNextAgent() {
    const agents = await this.getAvailableAgents();
    if (!agents || agents.length === 0) {
      const error = new Error('No active agents available for assignment');
      error.status = 503;
      throw error;
    }

    const lastAssignment = await this.getLastAssignment();
    if (!lastAssignment) {
      return agents[0];
    }

    const lastAgentIndex = agents.findIndex((agent) => agent.id === lastAssignment.assignedTo);
    if (lastAgentIndex === -1) {
      return agents[0];
    }

    return agents[(lastAgentIndex + 1) % agents.length];
  }

  async assignLead(leadId, assignedById = null, options = {}) {
    const assignee = options.assignedTo
      ? await User.findByPk(options.assignedTo)
      : await this.chooseNextAgent();

    if (!assignee || assignee.status !== 'active') {
      const error = new Error('Assigned agent not found or inactive');
      error.status = 404;
      throw error;
    }

    const assignment = await LeadAssignment.create({
      leadId,
      assignedTo: assignee.id,
      assignedBy: assignedById,
      note: options.note || (options.assignedTo ? 'Manual lead assignment' : 'Automated round-robin assignment')
    });

    const { Lead } = require('../models');
    await Lead.update({ ownerId: assignee.id }, { where: { id: leadId } });

    await assignee.reload();
    return { assignment, assignee };
  }

  async suggestAgentForLead({ lead, contact, conversationSummary, latestMessage }) {
    const agents = await this.getAvailableAgents();
    const suggestion = await aiService.suggestAgent({
      lead,
      contact,
      conversationSummary,
      availableAgents: agents
    });

    return {
      ...suggestion,
      agentHint: suggestion.recommendedAgent
        ? `${suggestion.recommendedAgent} — ${suggestion.reason || 'Suggested by AI based on lead details.'}`
        : suggestion.reason
    };
  }

  async getAssignmentHistory(leadId, limit = 20) {
    return LeadAssignment.findAll({
      where: { leadId },
      order: [['assigned_at', 'DESC']],
      limit
    });
  }
}

module.exports = new AssignmentService();
