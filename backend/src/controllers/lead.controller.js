const leadService = require('../services/lead.service');

class LeadController {
  async list(req, res, next) {
    try {
      const result = await leadService.listLeads(req.query, req.user);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async get(req, res, next) {
    try {
      const lead = await leadService.getLeadById(req.params.id, req.user);
      return res.status(200).json({ success: true, data: lead });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const lead = await leadService.createManualLead(req.body, req.user);
      return res.status(201).json({ success: true, data: lead });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const lead = await leadService.updateLead(req.params.id, req.body, req.user);
      return res.status(200).json({ success: true, data: lead });
    } catch (err) {
      next(err);
    }
  }

  async remove(req, res, next) {
    try {
      const result = await leadService.deleteLead(req.params.id);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async assign(req, res, next) {
    try {
      const lead = await leadService.assignLead(req.params.id, {
        assignedAgentId: req.body.assignedAgentId,
        assignedById: req.user?.id || null,
        note: req.body.note
      }, req.user);
      return res.status(200).json({ success: true, data: lead });
    } catch (err) {
      next(err);
    }
  }

  async autoAssign(req, res, next) {
    try {
      const result = await leadService.autoAssign({
        ...req.body,
        assignedById: req.user?.id || null
      });
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new LeadController();
