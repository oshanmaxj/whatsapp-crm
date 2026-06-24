const express = require('express');
const templateController = require('../controllers/template.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', templateController.list.bind(templateController));
router.post('/', templateController.create.bind(templateController));

module.exports = router;
