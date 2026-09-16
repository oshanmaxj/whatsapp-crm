const express = require('express');
const auth = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');
const controller = require('../controllers/facebookMessenger.controller');

const router = express.Router();
router.use(auth.authenticate);
router.get('/conversations', requirePermission('facebook-messenger.view'), controller.listConversations.bind(controller));
router.get('/conversations/:conversationId/messages', requirePermission('facebook-messenger.view'), controller.getMessages.bind(controller));
router.post('/conversations/:conversationId/messages', requirePermission('facebook-messenger.send'), controller.sendMessage.bind(controller));
module.exports = router;
