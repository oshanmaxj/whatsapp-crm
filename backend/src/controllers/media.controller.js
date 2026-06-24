const path = require('path');
const inboxService = require('../services/inbox.service');

class MediaController {
  async upload(req, res, next) {
    try {
      const data = await inboxService.createMedia({ ...req.body, uploadedBy: req.user?.id || null });
      return res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async list(req, res, next) {
    try {
      const data = await inboxService.listMedia(req.query.conversationId);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async download(req, res, next) {
    try {
      const media = await inboxService.getMedia(req.params.id);
      return res.download(media.storagePath, media.originalName || path.basename(media.storagePath));
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new MediaController();
