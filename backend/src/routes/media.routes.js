const express = require('express');
const mediaController = require('../controllers/media.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', mediaController.list.bind(mediaController));
router.post('/upload', express.json({ limit: '30mb' }), mediaController.upload.bind(mediaController));
router.get('/:id/download', mediaController.download.bind(mediaController));

module.exports = router;
