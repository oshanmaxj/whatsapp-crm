const express = require('express');
const productionController = require('../controllers/production.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { apiCache } = require('../middleware/cache.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/queue', productionController.listQueue.bind(productionController));
router.get('/queue/stats', apiCache({ ttlSeconds: 10 }), productionController.queueStats.bind(productionController));
router.post('/queue', productionController.enqueue.bind(productionController));
router.post('/queue/process', productionController.processQueue.bind(productionController));

router.get('/notifications', productionController.listNotifications.bind(productionController));
router.post('/notifications', productionController.createNotification.bind(productionController));
router.post('/notifications/:id/read', productionController.readNotification.bind(productionController));

router.get('/audit-logs', productionController.listAudit.bind(productionController));
router.get('/settings', apiCache({ ttlSeconds: 60 }), productionController.listSettings.bind(productionController));
router.put('/settings/:namespace/:key', productionController.saveSetting.bind(productionController));
router.get('/reports/summary', apiCache({ ttlSeconds: 30 }), productionController.reports.bind(productionController));
router.get('/backups', productionController.listBackups.bind(productionController));
router.post('/backups/export', productionController.exportBackup.bind(productionController));

module.exports = router;
