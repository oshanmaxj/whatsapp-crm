const express = require('express');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');
const controller = require('../controllers/smsGatewaySettings.controller');

const router = express.Router();
router.use(auth.authenticate);
router.get('/', permit('settings.view'), controller.get);
router.patch('/', permit('settings.edit'), controller.save);
router.post('/test-connection', permit('settings.edit'), controller.testConnection);
router.get('/masks', permit('settings.view'), controller.getMasks);
router.get('/balance', permit('settings.view'), controller.getBalance);
router.post('/send-test', permit('settings.edit'), controller.sendTest);
module.exports = router;
