const express = require('express');
const conversationController = require('../controllers/conversation.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', conversationController.list.bind(conversationController));
router.get('/assignable-users', conversationController.assignableUsers.bind(conversationController));
router.get('/:id', conversationController.get.bind(conversationController));
router.patch('/:id', conversationController.update.bind(conversationController));
router.post('/:id/assign', conversationController.assign.bind(conversationController));
router.post('/:id/labels', conversationController.setLabels.bind(conversationController));

module.exports = router;
