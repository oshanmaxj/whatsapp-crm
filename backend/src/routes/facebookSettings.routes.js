const express = require('express');
const auth = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');
const controller = require('../controllers/facebookSettings.controller');

const router = express.Router();
router.use(auth.authenticate);
router.get('/', requirePermission('settings.view'), controller.get.bind(controller));
router.patch('/', requirePermission('settings.edit'), controller.save.bind(controller));
router.post('/generate-verify-token', requirePermission('settings.edit'), controller.generateVerifyToken.bind(controller));
router.post('/test', requirePermission('settings.edit'), controller.test.bind(controller));
module.exports = router;
