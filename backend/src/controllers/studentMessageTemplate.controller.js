const service = require('../services/studentMessageAutomation.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

exports.list = async (req, res, next) => { try { return ok(res, { templates: await service.list(), variables: service.variables() }); } catch (error) { next(error); } };
exports.update = async (req, res, next) => { try { return ok(res, await service.update(req.params.id, req.body)); } catch (error) { next(error); } };
exports.preview = async (req, res, next) => { try { return ok(res, await service.preview(req.params.key, req.body?.variables)); } catch (error) { next(error); } };
exports.test = async (req, res, next) => { try { return ok(res, await service.sendTest(req.params.key, { ...req.body, createdBy: req.user?.id }), 201); } catch (error) { next(error); } };
