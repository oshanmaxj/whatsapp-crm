const express = require('express');
const flowController = require('../controllers/flow.controller');
const authMiddleware = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');
const flowMediaUpload = require('../middleware/flowMediaUpload.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/action-options', requirePermission('flow-builder.edit'), flowController.options.bind(flowController));
router.get('/', requirePermission('flow-builder.view'), flowController.list.bind(flowController));
router.get('/:id', requirePermission('flow-builder.view'), flowController.get.bind(flowController));
router.post('/', requirePermission('flow-builder.create'), flowController.create.bind(flowController));
router.patch('/:id', requirePermission('flow-builder.edit'), flowController.update.bind(flowController));
router.delete('/:id', requirePermission('flow-builder.delete'), flowController.remove.bind(flowController));
router.post('/:id/save-builder', requirePermission('flow-builder.edit'), flowController.saveBuilder.bind(flowController));
router.get('/:id/media/diagnostics', requirePermission('flow-builder.edit'), flowMediaUpload.diagnostics);
router.post('/:id/media', requirePermission('flow-builder.edit'), flowMediaUpload.flowMediaUpload, flowController.uploadMedia.bind(flowController));
router.post('/:id/publish', requirePermission('flow-builder.publish'), flowController.publish.bind(flowController));
router.post('/:id/unpublish', requirePermission('flow-builder.publish'), flowController.unpublish.bind(flowController));
router.post('/:id/test', requirePermission('flow-builder.test'), flowController.test.bind(flowController));
router.get('/:id/validate', requirePermission('flow-builder.publish'), flowController.validate.bind(flowController));
router.post('/:id/simulate-trigger', requirePermission('flow-builder.test'), flowController.simulateTrigger.bind(flowController));
router.post('/:id/duplicate', requirePermission('flow-builder.create'), flowController.duplicate.bind(flowController));
router.get('/:id/analytics', requirePermission('flow-builder.view'), flowController.analytics.bind(flowController));
router.get('/:id/stats', requirePermission('flow-builder.view'), flowController.stats.bind(flowController));
router.get('/:id/runs', requirePermission('flow-builder.view'), flowController.runs.bind(flowController));
router.get('/:id/logs', requirePermission('flow-builder.view'), flowController.logs.bind(flowController));
router.post('/:id/nodes', requirePermission('flow-builder.edit'), flowController.createNode.bind(flowController));
router.patch('/:id/nodes/:nodeKey', requirePermission('flow-builder.edit'), flowController.updateNode.bind(flowController));
router.delete('/:id/nodes/:nodeKey', requirePermission('flow-builder.edit'), flowController.deleteNode.bind(flowController));
router.post('/:id/connections', requirePermission('flow-builder.edit'), flowController.createConnection.bind(flowController));
router.delete('/:id/connections/:connectionId', requirePermission('flow-builder.edit'), flowController.deleteConnection.bind(flowController));

module.exports = router;
