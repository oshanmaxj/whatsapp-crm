const campaignService = require('../services/campaign.service');
const whatsappAccountAccessService = require('../services/whatsappAccountAccess.service');
const interactiveMediaService = require('../services/interactiveMedia.service');

class CampaignController {
  async uploadHeaderMedia(req, res, next) {
    try {
      const whatsappAccountId = req.body?.whatsappAccountId;
      await whatsappAccountAccessService.assertAccess(whatsappAccountId, req.user?.id);
      const media = await interactiveMediaService.storeAndUpload({
        scope: 'campaign',
        scopeId: `draft-${req.user?.id || 'unknown'}`,
        dataBase64: req.body?.dataBase64,
        fileName: req.body?.fileName,
        mimeType: req.body?.mimeType,
        mediaType: req.body?.mediaType,
        whatsappAccountId
      });
      return res.status(201).json({ success: true, data: media });
    } catch (err) { return next(err); }
  }
  async list(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.listCampaigns(req.query, req.user?.id) }); } catch (err) { next(err); }
  }
  async get(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.getCampaign(req.params.id, req.user?.id) }); } catch (err) { next(err); }
  }
  async create(req, res, next) {
    try { return res.status(201).json({ success: true, data: await campaignService.createCampaign(req.body, req.user?.id || null) }); } catch (err) { next(err); }
  }
  async update(req, res, next) {
    try {
      await campaignService.getCampaign(req.params.id, req.user?.id);
      if (req.body?.whatsappAccountId) {
        await whatsappAccountAccessService.assertAccess(req.body.whatsappAccountId, req.user?.id);
      }
      return res.json({ success: true, data: await campaignService.updateCampaign(req.params.id, req.body) });
    } catch (err) { next(err); }
  }
  async remove(req, res, next) {
    try { await campaignService.getCampaign(req.params.id, req.user?.id); return res.json({ success: true, data: await campaignService.deleteCampaign(req.params.id) }); } catch (err) { next(err); }
  }
  async send(req, res, next) {
    try { await campaignService.getCampaign(req.params.id, req.user?.id); return res.json({ success: true, data: await campaignService.sendCampaign(req.params.id) }); } catch (err) { next(err); }
  }
  async schedule(req, res, next) {
    try { await campaignService.getCampaign(req.params.id, req.user?.id); return res.json({ success: true, data: await campaignService.scheduleCampaign(req.params.id, req.body.scheduledAt) }); } catch (err) { next(err); }
  }
  async importRecipients(req, res, next) {
    try {
      const payload = typeof req.body === 'string' ? { csv: req.body } : req.body;
      await campaignService.getCampaign(req.params.id, req.user?.id);
      return res.json({ success: true, data: await campaignService.importRecipients(req.params.id, payload) });
    } catch (err) { next(err); }
  }
  async cancel(req, res, next) {
    try { await campaignService.getCampaign(req.params.id, req.user?.id); return res.json({ success: true, data: await campaignService.cancelCampaign(req.params.id) }); } catch (err) { next(err); }
  }
  async analytics(req, res, next) {
    try { await campaignService.getCampaign(req.params.id, req.user?.id); return res.json({ success: true, data: await campaignService.getAnalytics(req.params.id) }); } catch (err) { next(err); }
  }
  async previewAudience(req, res, next) {
    try {
      const options = req.method === 'POST' ? req.body : req.query;
      return res.json({ success: true, data: await campaignService.previewAudience(options) });
    } catch (err) { next(err); }
  }
  async audienceOptions(req, res, next) {
    try {
      return res.json({ success: true, data: await campaignService.audienceOptions() });
    } catch (err) { next(err); }
  }
}

module.exports = new CampaignController();
