const express = require('express');
const auth = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');
const controller = require('../controllers/facebookPage.controller');

const router = express.Router();
router.use(auth.authenticate);
router.get('/', requirePermission('facebook-pages.view'), controller.list.bind(controller));
router.get('/:id', requirePermission('facebook-pages.view'), controller.get.bind(controller));
router.post('/', requirePermission('facebook-pages.edit'), controller.create.bind(controller));
router.patch('/:id', requirePermission('facebook-pages.edit'), controller.update.bind(controller));
router.post('/:id/verify', requirePermission('facebook-pages.edit'), controller.verify.bind(controller));
router.post('/:id/subscribe-webhook', requirePermission('facebook-pages.edit'), controller.subscribeWebhook.bind(controller));
router.post('/:id/deactivate', requirePermission('facebook-pages.edit'), controller.deactivate.bind(controller));
module.exports = router;
