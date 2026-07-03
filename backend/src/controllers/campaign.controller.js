const campaignService = require('../services/campaign.service');

class CampaignController {
  async list(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.listCampaigns() }); } catch (err) { next(err); }
  }
  async get(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.getCampaign(req.params.id) }); } catch (err) { next(err); }
  }
  async create(req, res, next) {
    try { return res.status(201).json({ success: true, data: await campaignService.createCampaign(req.body, req.user?.id || null) }); } catch (err) { next(err); }
  }
  async update(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.updateCampaign(req.params.id, req.body) }); } catch (err) { next(err); }
  }
  async remove(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.deleteCampaign(req.params.id) }); } catch (err) { next(err); }
  }
  async send(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.sendCampaign(req.params.id) }); } catch (err) { next(err); }
  }
  async schedule(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.scheduleCampaign(req.params.id, req.body.scheduledAt) }); } catch (err) { next(err); }
  }
  async importRecipients(req, res, next) {
    try {
      const payload = typeof req.body === 'string' ? { csv: req.body } : req.body;
      return res.json({ success: true, data: await campaignService.importRecipients(req.params.id, payload) });
    } catch (err) { next(err); }
  }
  async cancel(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.cancelCampaign(req.params.id) }); } catch (err) { next(err); }
  }
  async analytics(req, res, next) {
    try { return res.json({ success: true, data: await campaignService.getAnalytics(req.params.id) }); } catch (err) { next(err); }
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
