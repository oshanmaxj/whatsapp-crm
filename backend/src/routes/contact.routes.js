const express = require('express');
const contactController = require('../controllers/contact.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { validateBody } = require('../middleware/validate.middleware');
const { createContactSchema, updateContactSchema } = require('../validators/contact.validator');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', contactController.list.bind(contactController));
router.get('/export', contactController.export.bind(contactController));
router.get('/:id', contactController.get.bind(contactController));
router.post('/', validateBody(createContactSchema), contactController.create.bind(contactController));
router.post('/import', express.text({ type: ['text/csv', 'text/plain', 'application/csv'] }), contactController.import.bind(contactController));
router.patch('/:id', validateBody(updateContactSchema), contactController.update.bind(contactController));
router.delete('/:id', contactController.remove.bind(contactController));

module.exports = router;
