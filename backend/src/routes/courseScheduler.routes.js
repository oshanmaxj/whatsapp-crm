const express = require('express');
const controller = require('../controllers/courseScheduler.controller');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');

const router = express.Router();
router.use(auth.authenticate);

router.get('/course-schedules', permit('courses.view'), controller.listSchedules);
router.post('/course-schedules', permit('courses.edit'), controller.createSchedule);
router.get('/course-schedules/:id', permit('courses.view'), controller.getSchedule);
router.patch('/course-schedules/:id', permit('courses.edit'), controller.updateSchedule);
router.delete('/course-schedules/:id', permit('courses.edit'), controller.deleteSchedule);
router.post('/course-schedules/:id/generate-lessons', permit('courses.edit'), controller.generateLessons);
router.get('/scheduled-lessons', permit('courses.view'), controller.listScheduledLessons);
router.patch('/scheduled-lessons/:id', permit('courses.edit'), controller.updateScheduledLesson);
router.post('/scheduled-lessons/:id/cancel', permit('courses.edit'), controller.cancelScheduledLesson);
router.post('/zoom-recordings/import', permit('courses.edit'), controller.importRecordings);
router.get('/zoom-recordings/imports', permit('courses.view'), controller.listImports);
router.get('/zoom-recordings/imports/:id', permit('courses.view'), controller.getImport);
router.get('/zoom-integration/settings', permit('settings.view'), controller.getZoomSettings);
router.patch('/zoom-integration/settings', permit('settings.edit'), controller.updateZoomSettings);

module.exports = router;
