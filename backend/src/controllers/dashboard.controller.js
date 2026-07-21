const dashboardService = require('../services/dashboard.service');

class DashboardController {
  async summary(req, res, next) {
    try {
      const summary = await dashboardService.getSummary(req.user);
      return res.status(200).json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  }

  async leaderboard(req, res, next) {
    try { return res.json({ success: true, data: await require('../services/dashboardAnalytics.service').leaderboard(req.user, req.query) }); }
    catch (err) { next(err); }
  }
}

module.exports = new DashboardController();
