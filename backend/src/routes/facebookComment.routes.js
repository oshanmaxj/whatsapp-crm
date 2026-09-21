const express = require('express');
const auth = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');
const controller = require('../controllers/facebookComment.controller');

const router = express.Router();
router.use(auth.authenticate);
router.get('/', requirePermission('facebook-comments.view'), controller.list.bind(controller));
router.get('/:id', requirePermission('facebook-comments.view'), controller.get.bind(controller));
router.post('/:id/reply', requirePermission('facebook-comments.reply'), controller.reply.bind(controller));
router.post('/:id/hide', requirePermission('facebook-comments.hide'), controller.hide.bind(controller));
router.post('/:id/unhide', requirePermission('facebook-comments.hide'), controller.unhide.bind(controller));
router.post('/:id/auto-hide/retry', requirePermission('facebook-comments.hide'), controller.retryAutoHide.bind(controller));
module.exports = router;
