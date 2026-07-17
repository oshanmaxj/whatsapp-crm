const scheduler = require('../services/courseScheduler.service');
const zoom = require('../services/zoomRecording.service');
const { checkZoomRecordingsJob } = require('../jobs/checkZoomRecordings.job');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

exports.listSchedules = async (req, res, next) => { try { return ok(res, await scheduler.list(req.query)); } catch (error) { next(error); } };
exports.getSchedule = async (req, res, next) => { try { return ok(res, await scheduler.get(req.params.id)); } catch (error) { next(error); } };
exports.createSchedule = async (req, res, next) => { try { return ok(res, await scheduler.create(req.body, req.user?.id), 201); } catch (error) { next(error); } };
exports.updateSchedule = async (req, res, next) => { try { return ok(res, await scheduler.update(req.params.id, req.body, req.user?.id)); } catch (error) { next(error); } };
exports.deleteSchedule = async (req, res, next) => { try { return ok(res, await scheduler.remove(req.params.id, req.user?.id)); } catch (error) { next(error); } };
exports.generateLessons = async (req, res, next) => { try { return ok(res, await scheduler.generateLessons(req.params.id, req.user?.id)); } catch (error) { next(error); } };
exports.listScheduledLessons = async (req, res, next) => { try { return ok(res, await scheduler.listScheduled(req.query)); } catch (error) { next(error); } };
exports.updateScheduledLesson = async (req, res, next) => { try { return ok(res, await scheduler.updateScheduled(req.params.id, req.body, req.user?.id)); } catch (error) { next(error); } };
exports.cancelScheduledLesson = async (req, res, next) => { try { return ok(res, await scheduler.cancelScheduled(req.params.id, req.user?.id)); } catch (error) { next(error); } };
exports.importRecordings = async (req, res, next) => { try { return ok(res, await checkZoomRecordingsJob(req.body || {}, req.user?.id)); } catch (error) { next(error); } };
exports.listImports = async (req, res, next) => { try { return ok(res, await zoom.listImports(req.query)); } catch (error) { next(error); } };
exports.getImport = async (req, res, next) => { try { return ok(res, await zoom.getImport(req.params.id)); } catch (error) { next(error); } };
exports.getZoomSettings = async (req, res, next) => { try { return ok(res, await zoom.settings(false)); } catch (error) { next(error); } };
exports.updateZoomSettings = async (req, res, next) => { try { return ok(res, await zoom.saveSettings(req.body, req.user?.id)); } catch (error) { next(error); } };
