const express = require('express');
const googleSheetsController = require('../controllers/googleSheets.controller');
const authMiddleware = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);
router.use(requirePermission('flow-builder.edit'));

router.get('/connections', googleSheetsController.list.bind(googleSheetsController));
router.post('/connections', googleSheetsController.create.bind(googleSheetsController));
router.patch('/connections/:id', googleSheetsController.update.bind(googleSheetsController));
router.delete('/connections/:id', googleSheetsController.remove.bind(googleSheetsController));
router.post('/test-row', googleSheetsController.testRow.bind(googleSheetsController));

module.exports = router;
