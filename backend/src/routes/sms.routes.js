const express = require('express');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');
const controller = require('../controllers/sms.controller');

const router = express.Router();
router.use(auth.authenticate);
router.post('/send', permit('sms.send'), controller.send);
module.exports = router;
