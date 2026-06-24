const express = require('express');
const workflowController = require('../controllers/workflow.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', workflowController.list.bind(workflowController));
router.get('/:id', workflowController.get.bind(workflowController));
router.post('/', workflowController.create.bind(workflowController));
router.patch('/:id', workflowController.update.bind(workflowController));
router.delete('/:id', workflowController.remove.bind(workflowController));
router.post('/:id/test', workflowController.test.bind(workflowController));

module.exports = router;
