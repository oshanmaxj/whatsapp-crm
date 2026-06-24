const express = require('express');
const agentController = require('../controllers/agent.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', agentController.list.bind(agentController));
router.get('/performance', agentController.performance.bind(agentController));

module.exports = router;
