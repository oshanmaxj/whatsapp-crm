const { fn, col } = require('sequelize');
const { User, Lead, LeadAssignment } = require('../models');
const assignmentService = require('./assignment.service');

function serializeAgent(agent, assignedLeadCount = 0) {
  return {
    id: agent.id,
    firstName: agent.firstName,
    lastName: agent.lastName,
    name: [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email,
    email: agent.email,
    phone: agent.phone,
    status: agent.status,
    assignedLeadCount: Number(assignedLeadCount || 0)
  };
}

class AgentService {
  async listAgents() {
    const agents = await assignmentService.getAvailableAgents();
    const counts = await Lead.findAll({
      attributes: ['ownerId', [fn('count', col('id')), 'leadCount']],
      where: { ownerId: agents.map((agent) => agent.id) },
      group: ['ownerId'],
      raw: true
    });
    const countsByAgent = new Map(counts.map((row) => [Number(row.ownerId), row.leadCount]));
    return agents.map((agent) => serializeAgent(agent, countsByAgent.get(Number(agent.id))));
  }

  async getPerformance() {
    const agents = await this.listAgents();
    const assignmentCounts = await LeadAssignment.findAll({
      attributes: ['assignedTo', [fn('count', col('id')), 'assignmentCount']],
      group: ['assignedTo'],
      raw: true
    });
    const assignmentsByAgent = new Map(assignmentCounts.map((row) => [Number(row.assignedTo), row.assignmentCount]));

    return agents.map((agent) => ({
      ...agent,
      assignmentCount: Number(assignmentsByAgent.get(Number(agent.id)) || 0)
    }));
  }
}

module.exports = new AgentService();
