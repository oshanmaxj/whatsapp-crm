const whatsappComplianceService = require('../services/whatsappCompliance.service');
const whatsappAccountAccessService = require('../services/whatsappAccountAccess.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class ComplianceController {
  async whatsappStatus(req, res, next) { try { return ok(res, await whatsappComplianceService.status()); } catch (err) { next(err); } }
  async messageCheck(req, res, next) { try { return ok(res, await whatsappComplianceService.messageCheck(req.body)); } catch (err) { next(err); } }

  // GET /compliance/whatsapp-windows?whatsappAccountId=123
  // A requested account is validated against the caller's own authorized
  // set via whatsappAccountAccessService — the same gate every other
  // account-scoped endpoint in this codebase already uses — never a
  // parallel authorization check. Omitting the query param aggregates
  // across every account the caller is authorized for (or every account at
  // all, for an unrestricted user) — never another agent's restricted data.
  async whatsappWindows(req, res, next) {
    try {
      const requestedAccountId = req.query.whatsappAccountId || null;
      if (requestedAccountId) await whatsappAccountAccessService.assertAccess(requestedAccountId, req.user?.id);
      const accessibleAccountIds = requestedAccountId ? null : await whatsappAccountAccessService.accessibleIds(req.user?.id);
      return ok(res, await whatsappComplianceService.windowDashboard({
        whatsappAccountId: requestedAccountId,
        _accessibleAccountIds: accessibleAccountIds
      }));
    } catch (err) { next(err); }
  }
}

module.exports = new ComplianceController();
