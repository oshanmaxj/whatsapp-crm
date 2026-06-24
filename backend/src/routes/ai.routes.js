const express = require('express');
const aiController = require('../controllers/ai.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/conversations/:conversationId/summary', aiController.getConversationSummary.bind(aiController));
router.get('/conversations/:conversationId/suggestions', aiController.getAgentSuggestion.bind(aiController));
router.get('/leads/:leadId/score', aiController.getLeadScore.bind(aiController));
router.post('/reply-preview', aiController.previewReply.bind(aiController));

module.exports = router;
