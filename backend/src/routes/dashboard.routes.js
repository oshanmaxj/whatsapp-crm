const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/summary', dashboardController.summary.bind(dashboardController));
router.get('/leaderboard', dashboardController.leaderboard.bind(dashboardController));

module.exports = router;
