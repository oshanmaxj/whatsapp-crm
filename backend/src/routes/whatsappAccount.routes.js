const express = require('express');
const auth = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');
const controller = require('../controllers/whatsappAccount.controller');

const router = express.Router();
router.use(auth.authenticate);
router.get('/', controller.list.bind(controller));
router.get('/:id', controller.get.bind(controller));
router.post('/', requirePermission('connect-whatsapp.edit'), controller.create.bind(controller));
router.patch('/:id', requirePermission('connect-whatsapp.edit'), controller.update.bind(controller));
router.delete('/:id', requirePermission('connect-whatsapp.edit'), controller.deactivate.bind(controller));
router.post('/:id/set-default', requirePermission('connect-whatsapp.edit'), controller.setDefault.bind(controller));
router.post('/:id/test-connection', requirePermission('connect-whatsapp.edit'), controller.test.bind(controller));
router.get('/:id/diagnostic', requirePermission('connect-whatsapp.edit'), controller.diagnostic.bind(controller));
router.get('/:id/webhook-subscription', requirePermission('connect-whatsapp.edit'), controller.checkWebhook.bind(controller));
router.post('/:id/webhook-subscription', requirePermission('connect-whatsapp.edit'), controller.subscribeWebhook.bind(controller));
router.post('/:id/webhook-callback-override', requirePermission('connect-whatsapp.edit'), controller.overrideWebhook.bind(controller));
module.exports = router;
