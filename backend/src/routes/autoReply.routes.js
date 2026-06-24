const express = require('express');
const autoReplyController = require('../controllers/autoReply.controller');
const { validateBody } = require('../middleware/validate.middleware');
const { createAutoReplySchema, updateAutoReplySchema } = require('../validators/autoReply.validator');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = require('../middleware/authorize.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);
router.use(authorize.adminOnly);

router.get('/', autoReplyController.list.bind(autoReplyController));
router.get('/:id', autoReplyController.get.bind(autoReplyController));
router.post('/', validateBody(createAutoReplySchema), autoReplyController.create.bind(autoReplyController));
router.patch('/:id', validateBody(updateAutoReplySchema), autoReplyController.update.bind(autoReplyController));
router.delete('/:id', autoReplyController.remove.bind(autoReplyController));

module.exports = router;