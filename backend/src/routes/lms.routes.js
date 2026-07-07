const express = require('express');
const controller = require('../controllers/lms.controller');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');

const router = express.Router();
router.use(auth.authenticate);
router.get('/lessons', permit('courses.view'), controller.list);
router.post('/lessons', permit('courses.edit'), controller.create);
router.get('/lessons/:id', permit('courses.view'), controller.get);
router.patch('/lessons/:id', permit('courses.edit'), controller.update);
router.delete('/lessons/:id', permit('courses.edit'), controller.remove);
router.post('/lessons/:id/publish', permit('courses.edit'), controller.publish);
router.post('/lessons/:id/unpublish', permit('courses.edit'), controller.unpublish);
router.post('/lessons/:id/materials', permit('courses.edit'), controller.addMaterial);
router.post('/materials/upload', permit('courses.edit'), express.raw({ type: 'application/octet-stream', limit: '25mb' }), controller.uploadMaterial);
router.delete('/materials/:id', permit('courses.edit'), controller.deleteMaterial);
module.exports = router;
