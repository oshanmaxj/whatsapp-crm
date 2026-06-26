const express = require('express');
const automationController = require('../controllers/automation.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/stats', automationController.stats.bind(automationController));
router.get('/', automationController.list.bind(automationController));
router.get('/:id', automationController.get.bind(automationController));
router.patch('/:id', automationController.update.bind(automationController));
router.post('/:id/toggle', automationController.toggle.bind(automationController));
router.post('/:id/run', automationController.run.bind(automationController));

module.exports = router;
