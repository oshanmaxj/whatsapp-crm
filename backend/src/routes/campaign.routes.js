const express = require('express');
const campaignController = require('../controllers/campaign.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/audience/preview', campaignController.previewAudience.bind(campaignController));
router.get('/', campaignController.list.bind(campaignController));
router.get('/:id', campaignController.get.bind(campaignController));
router.post('/', campaignController.create.bind(campaignController));
router.patch('/:id', campaignController.update.bind(campaignController));
router.delete('/:id', campaignController.remove.bind(campaignController));
router.post('/:id/send', campaignController.send.bind(campaignController));
router.post('/:id/cancel', campaignController.cancel.bind(campaignController));
router.get('/:id/analytics', campaignController.analytics.bind(campaignController));

module.exports = router;
