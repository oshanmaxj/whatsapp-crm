const express = require('express');
const labelController = require('../controllers/label.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', labelController.list.bind(labelController));
router.post('/', labelController.create.bind(labelController));

module.exports = router;
