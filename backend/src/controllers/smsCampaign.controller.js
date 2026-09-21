const service = require('../services/smsCampaign.service');
const audienceService = require('../services/smsCampaignAudience.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const wrap = fn => async (req, res, next) => { try { return await fn(req, res); } catch (error) { next(error); } };

exports.list = wrap(async (req, res) => ok(res, await service.list(req.query)));
exports.get = wrap(async (req, res) => ok(res, await service.get(req.params.id)));
exports.listRecipients = wrap(async (req, res) => ok(res, await service.listRecipients(req.params.id, req.query)));
exports.audienceOptions = wrap(async (req, res) => ok(res, await audienceService.audienceOptions()));
exports.previewAudience = wrap(async (req, res) => ok(res, await service.previewAudience(req.body)));
exports.create = wrap(async (req, res) => ok(res, await service.create(req.body, req.user), 201));
exports.update = wrap(async (req, res) => ok(res, await service.update(req.params.id, req.body, req.user)));
exports.remove = wrap(async (req, res) => ok(res, await service.remove(req.params.id, req.user)));
exports.send = wrap(async (req, res) => ok(res, await service.launch(req.params.id, { scheduledAt: null }, req.user)));
exports.schedule = wrap(async (req, res) => ok(res, await service.launch(req.params.id, { scheduledAt: req.body.scheduledAt }, req.user)));
exports.pause = wrap(async (req, res) => ok(res, await service.pause(req.params.id, req.user)));
exports.resume = wrap(async (req, res) => ok(res, await service.resume(req.params.id, req.user)));
exports.cancel = wrap(async (req, res) => ok(res, await service.cancel(req.params.id, req.user)));
exports.retry = wrap(async (req, res) => ok(res, await service.retryEligible(req.params.id, req.user)));
