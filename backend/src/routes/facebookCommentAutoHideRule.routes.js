const express = require('express');
const auth = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');
const controller = require('../controllers/facebookCommentAutoHideRule.controller');

const router = express.Router();
router.use(auth.authenticate);
router.get('/settings', requirePermission('facebook-comment-auto-hide.view'), controller.getSettings.bind(controller));
router.patch('/settings', requirePermission('facebook-comment-auto-hide.manage'), controller.updateSettings.bind(controller));
router.get('/', requirePermission('facebook-comment-auto-hide.view'), controller.list.bind(controller));
router.post('/', requirePermission('facebook-comment-auto-hide.manage'), controller.create.bind(controller));
router.patch('/:id', requirePermission('facebook-comment-auto-hide.manage'), controller.update.bind(controller));
router.delete('/:id', requirePermission('facebook-comment-auto-hide.manage'), controller.remove.bind(controller));
module.exports = router;
