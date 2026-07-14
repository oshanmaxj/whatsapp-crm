const express = require('express');
const leadController = require('../controllers/lead.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { validateBody } = require('../middleware/validate.middleware');
const { createLeadSchema, updateLeadSchema, assignLeadSchema, autoAssignSchema } = require('../validators/lead.validator');

const router = express.Router();
const pipelineController = require('../controllers/pipeline.controller');

router.use(authMiddleware.authenticate);

router.get('/pipeline', pipelineController.board);
router.patch('/:id/status', leadController.updateStatus.bind(leadController));
router.get('/:id/history', pipelineController.history);
router.get('/', leadController.list.bind(leadController));
router.get('/:id', leadController.get.bind(leadController));
router.post('/', validateBody(createLeadSchema), leadController.create.bind(leadController));
router.patch('/:id', validateBody(updateLeadSchema), leadController.update.bind(leadController));
router.delete('/:id', leadController.remove.bind(leadController));
router.post('/:id/assign', validateBody(assignLeadSchema), leadController.assign.bind(leadController));
router.post('/auto-assign', validateBody(autoAssignSchema), leadController.autoAssign.bind(leadController));

module.exports = router;
