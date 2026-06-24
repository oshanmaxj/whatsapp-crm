const dashboardService = require('../services/dashboard.service');

class DashboardController {
  async summary(req, res, next) {
    try {
      const summary = await dashboardService.getSummary();
      return res.status(200).json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new DashboardController();
