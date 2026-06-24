const express = require('express');
const appointmentController = require('../controllers/appointment.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/', appointmentController.list.bind(appointmentController));
router.get('/:id', appointmentController.get.bind(appointmentController));
router.post('/', appointmentController.create.bind(appointmentController));
router.patch('/:id', appointmentController.update.bind(appointmentController));
router.delete('/:id', appointmentController.remove.bind(appointmentController));
router.post('/:id/confirm', appointmentController.confirm.bind(appointmentController));
router.post('/:id/cancel', appointmentController.cancel.bind(appointmentController));
router.post('/:id/reminder', appointmentController.reminder.bind(appointmentController));

module.exports = router;
