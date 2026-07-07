const express = require('express');
const controller = require('../controllers/studentMessageTemplate.controller');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');

const router = express.Router();
router.use(auth.authenticate);
router.get('/', permit('settings.view'), controller.list);
router.patch('/:id', permit('settings.edit'), controller.update);
router.post('/:key/preview', permit('settings.view'), controller.preview);
router.post('/:key/test', permit('settings.edit'), controller.test);
module.exports = router;
