const smsMessageService = require('../services/smsMessage.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const wrap = fn => async (req, res, next) => { try { return await fn(req, res); } catch (error) { next(error); } };

exports.send = wrap(async (req, res) => ok(res, await smsMessageService.sendSingle(req.body, req.user), 201));
exports.list = wrap(async (req, res) => ok(res, await smsMessageService.list(req.query)));
exports.get = wrap(async (req, res) => ok(res, await smsMessageService.getById(req.params.id)));
