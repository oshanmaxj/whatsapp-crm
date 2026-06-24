const agentService = require('../services/agent.service');

class AgentController {
  async list(req, res, next) {
    try {
      const agents = await agentService.listAgents();
      return res.status(200).json({ success: true, data: agents });
    } catch (err) {
      next(err);
    }
  }

  async performance(req, res, next) {
    try {
      const performance = await agentService.getPerformance();
      return res.status(200).json({ success: true, data: performance });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AgentController();
