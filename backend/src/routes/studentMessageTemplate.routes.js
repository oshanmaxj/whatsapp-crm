const express = require('express');
const controller = require('../controllers/studentMessageTemplate.controller');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');

const router = express.Router();
router.use(auth.authenticate);
router.get('/students/:studentId/onboarding', permit('students.view'), controller.onboardingStatus);
router.post('/students/:studentId/onboarding', permit('student.onboarding.send'), controller.sendOnboarding);
router.post('/students/:studentId/onboarding/force', permit('student.onboarding.force_resend'), controller.forceOnboarding);
router.get('/', permit('settings.view'), controller.list);
router.patch('/:id', permit('settings.edit'), controller.update);
router.post('/:key/preview', permit('settings.view'), controller.preview);
router.post('/:key/test', permit('settings.edit'), controller.test);
module.exports = router;
