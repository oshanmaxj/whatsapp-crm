const educationService = require('../services/education.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class EducationController {
  async listCourses(req, res, next) { try { return ok(res, await educationService.listCourses(req.query)); } catch (err) { next(err); } }
  async searchCourses(req, res, next) { try { return ok(res, await educationService.searchCourses(req.query)); } catch (err) { next(err); } }
  async getCourse(req, res, next) { try { return ok(res, await educationService.getCourse(req.params.id)); } catch (err) { next(err); } }
  async createCourse(req, res, next) { try { return ok(res, await educationService.createCourse(req.body), 201); } catch (err) { next(err); } }
  async updateCourse(req, res, next) { try { return ok(res, await educationService.updateCourse(req.params.id, req.body)); } catch (err) { next(err); } }
  async deleteCourse(req, res, next) { try { return ok(res, await educationService.deleteCourse(req.params.id)); } catch (err) { next(err); } }

  async listBatches(req, res, next) { try { return ok(res, await educationService.listBatches(req.query)); } catch (err) { next(err); } }
  async searchBatches(req, res, next) { try { return ok(res, await educationService.searchBatches(req.query)); } catch (err) { next(err); } }
  async getBatch(req, res, next) { try { return ok(res, await educationService.getBatch(req.params.id)); } catch (err) { next(err); } }
  async createBatch(req, res, next) { try { return ok(res, await educationService.createBatch(req.body), 201); } catch (err) { next(err); } }
  async updateBatch(req, res, next) { try { return ok(res, await educationService.updateBatch(req.params.id, req.body)); } catch (err) { next(err); } }
  async deleteBatch(req, res, next) { try { return ok(res, await educationService.deleteBatch(req.params.id)); } catch (err) { next(err); } }

  async listStudents(req, res, next) { try { return ok(res, await educationService.listStudents(req.query)); } catch (err) { next(err); } }
  async searchStudents(req, res, next) { try { return ok(res, await educationService.searchStudents(req.query)); } catch (err) { next(err); } }
  async getStudentProfile(req, res, next) { try { return ok(res, await educationService.getStudentProfile(req.params.id)); } catch (err) { next(err); } }
  async getStudent(req, res, next) { try { return ok(res, await educationService.getStudent(req.params.id)); } catch (err) { next(err); } }
  async listStudentEnrollments(req, res, next) { try { return ok(res, await educationService.listStudentEnrollments(req.params.id)); } catch (err) { next(err); } }
  async createStudentEnrollment(req, res, next) { try { return ok(res, await educationService.createStudentEnrollment(req.params.id, req.body, req.user?.id || null), 201); } catch (err) { next(err); } }
  async updateEnrollment(req, res, next) { try { return ok(res, await educationService.updateEnrollment(req.params.id, req.body)); } catch (err) { next(err); } }
  async deleteEnrollment(req, res, next) { try { return ok(res, await educationService.deleteEnrollment(req.params.id)); } catch (err) { next(err); } }
  async createStudent(req, res, next) {
    try {
      const payload = { ...req.body, enrollments: req.body.enrollments };
      return ok(res, await educationService.createStudent(payload, req.user?.id || null), 201);
    } catch (err) { next(err); }
  }
  async updateStudent(req, res, next) { try { return ok(res, await educationService.updateStudent(req.params.id, req.body, req.user?.id || null)); } catch (err) { next(err); } }
  async resetStudentPortalPassword(req, res, next) { try { return ok(res, await educationService.resetStudentPortalPassword(req.params.id, req.body)); } catch (err) { next(err); } }
  async deleteStudent(req, res, next) { try { return ok(res, await educationService.deleteStudent(req.params.id)); } catch (err) { next(err); } }
  async convertLead(req, res, next) {
    try {
      const payload = { ...req.body, enrollments: req.body.enrollments };
      return ok(res, await educationService.convertLeadToStudent(req.params.id, payload, req.user), 201);
    } catch (err) { next(err); }
  }

  async listFees(req, res, next) { try { return ok(res, await educationService.listFees(req.query)); } catch (err) { next(err); } }
  async getFee(req, res, next) { try { return ok(res, await educationService.getFee(req.params.id)); } catch (err) { next(err); } }
  async createFee(req, res, next) { try { return ok(res, await educationService.createFee(req.body, req.user), 201); } catch (err) { next(err); } }
  async updateFee(req, res, next) { try { return ok(res, await educationService.updateFee(req.params.id, req.body)); } catch (err) { next(err); } }
  async deleteFee(req, res, next) { try { return ok(res, await educationService.deleteFee(req.params.id)); } catch (err) { next(err); } }
  async payInstallment(req, res, next) { try { return ok(res, await educationService.payInstallment(req.params.id, req.body, req.user)); } catch (err) { next(err); } }
  async confirmInstallment(req, res, next) { try { return ok(res, await educationService.confirmInstallmentPayment(req.params.id, req.user?.id || null)); } catch (err) { next(err); } }
  async rejectInstallment(req, res, next) { try { return ok(res, await educationService.rejectInstallmentPayment(req.params.id, req.body, req.user?.id || null)); } catch (err) { next(err); } }
  async reverseInstallment(req, res, next) { try { return ok(res, await educationService.reverseInstallmentPayment(req.params.id, req.body, req.user?.id || null)); } catch (err) { next(err); } }
  async remindInstallment(req, res, next) { try { return ok(res, await educationService.sendFeeReminder(req.params.id)); } catch (err) { next(err); } }

  async listAttendance(req, res, next) { try { return ok(res, await educationService.listAttendance(req.query)); } catch (err) { next(err); } }
  async createAttendance(req, res, next) { try { return ok(res, await educationService.createAttendance(req.body, req.user?.id || null), 201); } catch (err) { next(err); } }
  async updateAttendance(req, res, next) { try { return ok(res, await educationService.updateAttendance(req.params.id, req.body)); } catch (err) { next(err); } }
  async deleteAttendance(req, res, next) { try { return ok(res, await educationService.deleteAttendance(req.params.id)); } catch (err) { next(err); } }

  async listCertificates(req, res, next) { try { return ok(res, await educationService.listCertificates(req.query)); } catch (err) { next(err); } }
  async createCertificate(req, res, next) { try { return ok(res, await educationService.createCertificate(req.body, req.user?.id || null), 201); } catch (err) { next(err); } }
  async updateCertificate(req, res, next) { try { return ok(res, await educationService.updateCertificate(req.params.id, req.body)); } catch (err) { next(err); } }
  async deleteCertificate(req, res, next) { try { return ok(res, await educationService.deleteCertificate(req.params.id)); } catch (err) { next(err); } }

  async listStudentNotes(req, res, next) { try { return ok(res, await educationService.listStudentNotes(req.params.id)); } catch (err) { next(err); } }
  async createStudentNote(req, res, next) { try { return ok(res, await educationService.createStudentNote(req.params.id, req.body, req.user?.id || null), 201); } catch (err) { next(err); } }
  async deleteStudentNote(req, res, next) { try { return ok(res, await educationService.deleteStudentNote(req.params.id)); } catch (err) { next(err); } }

  async listStudentDocuments(req, res, next) { try { return ok(res, await educationService.listStudentDocuments(req.params.id)); } catch (err) { next(err); } }
  async createStudentDocument(req, res, next) { try { return ok(res, await educationService.createStudentDocument(req.params.id, req.body, req.user?.id || null), 201); } catch (err) { next(err); } }
  async deleteStudentDocument(req, res, next) { try { return ok(res, await educationService.deleteStudentDocument(req.params.id)); } catch (err) { next(err); } }

  async listStudentGuardians(req, res, next) { try { return ok(res, await educationService.listStudentGuardians(req.params.id)); } catch (err) { next(err); } }
  async createStudentGuardian(req, res, next) { try { return ok(res, await educationService.createStudentGuardian(req.params.id, req.body), 201); } catch (err) { next(err); } }
  async updateStudentGuardian(req, res, next) { try { return ok(res, await educationService.updateStudentGuardian(req.params.guardianId, req.body)); } catch (err) { next(err); } }
  async deleteStudentGuardian(req, res, next) { try { return ok(res, await educationService.deleteStudentGuardian(req.params.guardianId)); } catch (err) { next(err); } }
}

module.exports = new EducationController();
