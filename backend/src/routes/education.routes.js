const express = require('express');
const educationController = require('../controllers/education.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/courses', educationController.listCourses.bind(educationController));
router.get('/courses/:id', educationController.getCourse.bind(educationController));
router.post('/courses', educationController.createCourse.bind(educationController));
router.patch('/courses/:id', educationController.updateCourse.bind(educationController));
router.delete('/courses/:id', educationController.deleteCourse.bind(educationController));

router.get('/batches', educationController.listBatches.bind(educationController));
router.get('/batches/:id', educationController.getBatch.bind(educationController));
router.post('/batches', educationController.createBatch.bind(educationController));
router.patch('/batches/:id', educationController.updateBatch.bind(educationController));
router.delete('/batches/:id', educationController.deleteBatch.bind(educationController));

router.get('/students', educationController.listStudents.bind(educationController));
router.get('/students/:id/profile', educationController.getStudentProfile.bind(educationController));
router.get('/students/:id/notes', educationController.listStudentNotes.bind(educationController));
router.post('/students/:id/notes', educationController.createStudentNote.bind(educationController));
router.delete('/students/notes/:id', educationController.deleteStudentNote.bind(educationController));
router.get('/students/:id/documents', educationController.listStudentDocuments.bind(educationController));
router.post('/students/:id/documents', educationController.createStudentDocument.bind(educationController));
router.delete('/students/documents/:id', educationController.deleteStudentDocument.bind(educationController));
router.get('/students/:id/guardians', educationController.listStudentGuardians.bind(educationController));
router.post('/students/:id/guardians', educationController.createStudentGuardian.bind(educationController));
router.patch('/students/guardians/:guardianId', educationController.updateStudentGuardian.bind(educationController));
router.delete('/students/guardians/:guardianId', educationController.deleteStudentGuardian.bind(educationController));
router.get('/students/:id', educationController.getStudent.bind(educationController));
router.post('/students', educationController.createStudent.bind(educationController));
router.patch('/students/:id', educationController.updateStudent.bind(educationController));
router.delete('/students/:id', educationController.deleteStudent.bind(educationController));
router.post('/leads/:id/convert-to-student', educationController.convertLead.bind(educationController));

router.get('/fees', educationController.listFees.bind(educationController));
router.get('/fees/:id', educationController.getFee.bind(educationController));
router.post('/fees', educationController.createFee.bind(educationController));
router.patch('/fees/:id', educationController.updateFee.bind(educationController));
router.delete('/fees/:id', educationController.deleteFee.bind(educationController));
router.post('/fees/installments/:id/pay', educationController.payInstallment.bind(educationController));
router.post('/fees/installments/:id/reminder', educationController.remindInstallment.bind(educationController));

router.get('/attendance', educationController.listAttendance.bind(educationController));
router.post('/attendance', educationController.createAttendance.bind(educationController));
router.patch('/attendance/:id', educationController.updateAttendance.bind(educationController));
router.delete('/attendance/:id', educationController.deleteAttendance.bind(educationController));

router.get('/certificates', educationController.listCertificates.bind(educationController));
router.post('/certificates', educationController.createCertificate.bind(educationController));
router.patch('/certificates/:id', educationController.updateCertificate.bind(educationController));
router.delete('/certificates/:id', educationController.deleteCertificate.bind(educationController));

module.exports = router;
