const express = require('express');
const controller = require('../controllers/notificationTemplate.controller');
const auth = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');

const router = express.Router();
router.use(auth.authenticate);
router.get('/', requirePermission('settings.view'), controller.list.bind(controller));
router.get('/:key', requirePermission('settings.view'), controller.get.bind(controller));
router.patch('/:id', requirePermission('settings.edit'), controller.update.bind(controller));
router.post('/:key/preview', requirePermission('settings.view'), controller.preview.bind(controller));

module.exports = router;
