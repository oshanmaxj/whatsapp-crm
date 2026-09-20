const settingsService = require('../services/smsGatewaySettings.service');
const smsMessageService = require('../services/smsMessage.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const wrap = fn => async (req, res, next) => { try { return await fn(req, res); } catch (error) { next(error); } };

exports.get = wrap(async (req, res) => ok(res, await settingsService.getPublicMetadata()));
exports.save = wrap(async (req, res) => ok(res, await settingsService.save(req.body, req.user?.id || null)));
exports.testConnection = wrap(async (req, res) => ok(res, await settingsService.testConnection(req.user?.id || null)));
exports.getMasks = wrap(async (req, res) => ok(res, await settingsService.getMasks()));
exports.getBalance = wrap(async (req, res) => ok(res, await settingsService.getBalance()));
exports.sendTest = wrap(async (req, res) => ok(res, await smsMessageService.sendSingle({ ...req.body, source: 'test' }, req.user), 201));
