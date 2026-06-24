const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { apiCache } = require('../middleware/cache.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/summary', apiCache({ ttlSeconds: 30 }), dashboardController.summary.bind(dashboardController));

module.exports = router;
