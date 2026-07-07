const lmsService = require('../services/lms.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

exports.list = async (req, res, next) => { try { return ok(res, await lmsService.listLessons(req.query)); } catch (error) { next(error); } };
exports.get = async (req, res, next) => { try { return ok(res, await lmsService.getLesson(req.params.id)); } catch (error) { next(error); } };
exports.create = async (req, res, next) => { try { return ok(res, await lmsService.createLesson(req.body, req.user?.id), 201); } catch (error) { next(error); } };
exports.update = async (req, res, next) => { try { return ok(res, await lmsService.updateLesson(req.params.id, req.body)); } catch (error) { next(error); } };
exports.remove = async (req, res, next) => { try { return ok(res, await lmsService.deleteLesson(req.params.id)); } catch (error) { next(error); } };
exports.publish = async (req, res, next) => { try { return ok(res, await lmsService.setPublished(req.params.id, true)); } catch (error) { next(error); } };
exports.unpublish = async (req, res, next) => { try { return ok(res, await lmsService.setPublished(req.params.id, false)); } catch (error) { next(error); } };
exports.addMaterial = async (req, res, next) => { try { return ok(res, await lmsService.addMaterial(req.params.id, req.body), 201); } catch (error) { next(error); } };
exports.uploadMaterial = async (req, res, next) => { try { return ok(res, await lmsService.uploadMaterialFile(req.body, req.get('x-file-name'), req.get('content-type')), 201); } catch (error) { next(error); } };
exports.deleteMaterial = async (req, res, next) => { try { return ok(res, await lmsService.deleteMaterial(req.params.id)); } catch (error) { next(error); } };
