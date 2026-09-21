const express = require('express');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');
const controller = require('../controllers/smsCampaign.controller');

const router = express.Router();
router.use(auth.authenticate);

router.get('/audience/options', permit('sms_campaigns.view'), controller.audienceOptions);
router.post('/audience/preview', permit('sms_campaigns.view'), controller.previewAudience);

router.get('/', permit('sms_campaigns.view'), controller.list);
router.get('/:id', permit('sms_campaigns.view'), controller.get);
router.get('/:id/recipients', permit('sms_campaigns.view'), controller.listRecipients);

router.post('/', permit('sms_campaigns.create'), controller.create);
router.patch('/:id', permit('sms_campaigns.manage'), controller.update);
router.delete('/:id', permit('sms_campaigns.manage'), controller.remove);

router.post('/:id/send', permit('sms_campaigns.send'), controller.send);
router.post('/:id/schedule', permit('sms_campaigns.send'), controller.schedule);
router.post('/:id/pause', permit('sms_campaigns.manage'), controller.pause);
router.post('/:id/resume', permit('sms_campaigns.manage'), controller.resume);
router.post('/:id/cancel', permit('sms_campaigns.manage'), controller.cancel);
router.post('/:id/retry', permit('sms_campaigns.manage'), controller.retry);

module.exports = router;
