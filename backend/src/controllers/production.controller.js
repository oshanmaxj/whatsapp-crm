const auditService = require('../services/audit.service');
const backupService = require('../services/backup.service');
const messageQueueService = require('../services/messageQueue.service');
const notificationService = require('../services/notification.service');
const reportService = require('../services/report.service');
const settingsService = require('../services/settings.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class ProductionController {
  async listQueue(req, res, next) { try { return ok(res, await messageQueueService.list(req.query)); } catch (err) { next(err); } }
  async queueStats(req, res, next) { try { return ok(res, await messageQueueService.stats()); } catch (err) { next(err); } }
  async enqueue(req, res, next) { try { return ok(res, await messageQueueService.enqueue(req.body, req.user?.id || null), 201); } catch (err) { next(err); } }
  async processQueue(req, res, next) { try { return ok(res, await messageQueueService.processDue(Number(req.body?.limit) || 5)); } catch (err) { next(err); } }

  async listNotifications(req, res, next) { try { return ok(res, await notificationService.list(req.user?.id || null, req.query)); } catch (err) { next(err); } }
  async createNotification(req, res, next) { try { return ok(res, await notificationService.create(req.body), 201); } catch (err) { next(err); } }
  async readNotification(req, res, next) { try { return ok(res, await notificationService.markRead(req.params.id)); } catch (err) { next(err); } }

  async listAudit(req, res, next) { try { return ok(res, await auditService.list(req.query)); } catch (err) { next(err); } }
  async listSettings(req, res, next) { try { return ok(res, await settingsService.list()); } catch (err) { next(err); } }
  async saveSetting(req, res, next) { try { return ok(res, await settingsService.upsert(req.params.namespace, req.params.key, req.body.value || req.body, req.user?.id || null)); } catch (err) { next(err); } }
  async reports(req, res, next) { try { return ok(res, await reportService.summary(req.query)); } catch (err) { next(err); } }
  async listBackups(req, res, next) { try { return ok(res, await backupService.list()); } catch (err) { next(err); } }
  async exportBackup(req, res, next) { try { return ok(res, await backupService.export(req.user?.id || null), 201); } catch (err) { next(err); } }
  async downloadBackup(req, res, next) {
    try {
      const backup = await backupService.get(req.params.id);
      if (!backup.filePath || backup.status !== 'completed') {
        const error = new Error('Backup file is not available');
        error.status = 404;
        throw error;
      }
      return res.download(backup.filePath);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ProductionController();
