const express = require('express');
const noteController = require('../controllers/note.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', noteController.list.bind(noteController));
router.post('/', noteController.create.bind(noteController));

module.exports = router;
