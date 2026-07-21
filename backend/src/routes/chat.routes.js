const express = require('express');
const chatController = require('../controllers/chat.controller');
const authMiddleware = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/conversations', chatController.getConversations.bind(chatController));
router.get('/conversations/:conversationId/messages', chatController.getMessages.bind(chatController));
router.post('/conversations/:conversationId/messages', chatController.sendMessage.bind(chatController));
router.post('/conversations/:conversationId/interactive', express.json({ limit: '140mb' }), chatController.sendInteractive.bind(chatController));
router.post('/conversations/:conversationId/template', requirePermission('templates.send'), chatController.sendTemplate.bind(chatController));
router.get('/conversations/:conversationId/template-diagnostics', chatController.templateDiagnostics.bind(chatController));
router.get('/unread', chatController.getUnread.bind(chatController));

module.exports = router;
