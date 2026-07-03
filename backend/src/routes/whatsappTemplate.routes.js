const express = require('express');
const whatsappTemplateController = require('../controllers/whatsappTemplate.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/', whatsappTemplateController.list.bind(whatsappTemplateController));
router.post('/sample-media', whatsappTemplateController.uploadSample.bind(whatsappTemplateController));
router.get('/:id', whatsappTemplateController.get.bind(whatsappTemplateController));
router.post('/', whatsappTemplateController.create.bind(whatsappTemplateController));
router.patch('/:id', whatsappTemplateController.update.bind(whatsappTemplateController));
router.delete('/:id', whatsappTemplateController.delete.bind(whatsappTemplateController));
router.post('/:id/submit', whatsappTemplateController.submit.bind(whatsappTemplateController));
router.post('/sync', whatsappTemplateController.sync.bind(whatsappTemplateController));

module.exports = router;
