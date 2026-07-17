const studentPortalService = require('../services/studentPortal.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

exports.login = async (req, res, next) => { try { return ok(res, await studentPortalService.login(req.body)); } catch (error) { next(error); } };
exports.verifyOtp = async (req, res, next) => { try { return ok(res, await studentPortalService.verifyOtp(req.body)); } catch (error) { next(error); } };
exports.me = async (req, res) => ok(res, { student: req.student, paymentAccess: req.studentPaymentAccess });
exports.dashboard = async (req, res, next) => { try { return ok(res, await studentPortalService.dashboard(req.student, req.studentPaymentAccess)); } catch (error) { next(error); } };
exports.myCourses = async (req, res, next) => { try { return ok(res, await studentPortalService.myCourses(req.student, req.studentPaymentAccess)); } catch (error) { next(error); } };
exports.courseCurriculum = async (req, res, next) => { try { return ok(res, await studentPortalService.courseCurriculum(req.student, req.params.courseId, req.studentPaymentAccess)); } catch (error) { next(error); } };
exports.upcomingClasses = async (req, res, next) => { try { return ok(res, await studentPortalService.upcomingClasses(req.student, req.studentPaymentAccess)); } catch (error) { next(error); } };
exports.lessons = async (req, res, next) => { try { return ok(res, await studentPortalService.lessons(req.student, req.studentPaymentAccess)); } catch (error) { next(error); } };
exports.materials = async (req, res, next) => { try { return ok(res, await studentPortalService.materials(req.student, req.studentPaymentAccess)); } catch (error) { next(error); } };
exports.lesson = async (req, res, next) => { try { return ok(res, await studentPortalService.lesson(req.student, req.params.id, req.studentPaymentAccess)); } catch (error) { next(error); } };
exports.comment = async (req, res, next) => { try { return ok(res, await studentPortalService.addComment(req.student, req.params.id, req.body), 201); } catch (error) { next(error); } };
exports.progress = async (req, res, next) => { try { return ok(res, await studentPortalService.updateProgress(req.student, req.params.id, req.body)); } catch (error) { next(error); } };
exports.complete = async (req, res, next) => { try { return ok(res, await studentPortalService.updateProgress(req.student, req.params.id, { ...req.body, isCompleted: true, watchedPercentage: 100 })); } catch (error) { next(error); } };
exports.join = async (req, res, next) => { try { return ok(res, await studentPortalService.joinLiveClass(req.student, req.params.id, { ipAddress: req.ip, userAgent: req.get('user-agent') })); } catch (error) { next(error); } };
exports.payments = async (req, res) => ok(res, req.studentPaymentAccess);
