const whatsappComplianceService = require('../services/whatsappCompliance.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class ComplianceController {
  async whatsappStatus(req, res, next) { try { return ok(res, await whatsappComplianceService.status()); } catch (err) { next(err); } }
  async messageCheck(req, res, next) { try { return ok(res, await whatsappComplianceService.messageCheck(req.body)); } catch (err) { next(err); } }
}

module.exports = new ComplianceController();
