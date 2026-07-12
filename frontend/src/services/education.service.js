import api from './api';

const normalizeEnrollment = (row = {}) => {
  const feePlan = row.feePlan || row.fee_plan || row.paymentType || row.payment_type || 'full';
  const rawInstallments = row.installments ?? row.installmentCount ?? row.installment_count;
  const installmentCount = Number(rawInstallments);
  return {
    ...(row.id ? { id: row.id } : {}),
    courseId: row.courseId || row.course_id,
    batchId: row.batchId || row.batch_id || null,
    status: row.status || row.enrollmentStatus || row.enrollment_status || 'active',
    feePlan,
    installments: feePlan === 'installment' && Number.isFinite(installmentCount) && installmentCount >= 1
      ? Math.floor(installmentCount)
      : feePlan === 'installment' ? null : 1
  };
};

const normalizeStudentPayload = (payload = {}) => ({
  ...payload,
  studentPortalPassword: payload.studentPortalPassword ?? payload.portalPassword ?? '',
  ...(Array.isArray(payload.enrollments)
    ? { enrollments: payload.enrollments.filter((row) => row.courseId || row.course_id).map(normalizeEnrollment) }
    : {})
});

export const listCourses = (params = {}) => api.get('/courses', { params });
export const createCourse = (payload) => api.post('/courses', payload);
export const updateCourse = (id, payload) => api.patch(`/courses/${id}`, payload);
export const deleteCourse = (id) => api.delete(`/courses/${id}`);

export const listBatches = (params = {}) => api.get('/batches', { params });
export const createBatch = (payload) => api.post('/batches', payload);
export const updateBatch = (id, payload) => api.patch(`/batches/${id}`, payload);
export const deleteBatch = (id) => api.delete(`/batches/${id}`);

export const listStudents = (params = {}) => api.get('/students', { params });
export const getStudentProfile = (id) => api.get(`/students/${id}/profile`);
export const createStudent = (payload) => api.post('/students', normalizeStudentPayload(payload));
export const updateStudent = (id, payload) => api.patch(`/students/${id}`, normalizeStudentPayload(payload));
export const listStudentEnrollments = (id) => api.get(`/students/${id}/enrollments`);
export const createStudentEnrollment = (id, payload) => api.post(`/students/${id}/enrollments`, payload);
export const updateEnrollment = (id, payload) => api.patch(`/enrollments/${id}`, payload);
export const deleteEnrollment = (id) => api.delete(`/enrollments/${id}`);
export const resetStudentPortalPassword = (id, password) => api.post(`/students/${id}/reset-portal-password`, password ? { password } : {});
export const deleteStudent = (id) => api.delete(`/students/${id}`);
export const convertLeadToStudent = (leadId, payload) => api.post(`/leads/${leadId}/convert-to-student`, normalizeStudentPayload(payload));
export const listStudentNotes = (id) => api.get(`/students/${id}/notes`);
export const createStudentNote = (id, payload) => api.post(`/students/${id}/notes`, payload);
export const deleteStudentNote = (id) => api.delete(`/students/notes/${id}`);
export const listStudentDocuments = (id) => api.get(`/students/${id}/documents`);
export const createStudentDocument = (id, payload) => api.post(`/students/${id}/documents`, payload);
export const deleteStudentDocument = (id) => api.delete(`/students/documents/${id}`);
export const listStudentGuardians = (id) => api.get(`/students/${id}/guardians`);
export const createStudentGuardian = (id, payload) => api.post(`/students/${id}/guardians`, payload);
export const updateStudentGuardian = (guardianId, payload) => api.patch(`/students/guardians/${guardianId}`, payload);
export const deleteStudentGuardian = (guardianId) => api.delete(`/students/guardians/${guardianId}`);

export const listFees = (params = {}) => api.get('/fees', { params });
export const createFee = (payload) => api.post('/fees', payload);
export const updateFee = (id, payload) => api.patch(`/fees/${id}`, payload);
export const deleteFee = (id) => api.delete(`/fees/${id}`);
export const payInstallment = (id, payload) => api.post(`/fees/installments/${id}/pay`, payload);
export const confirmInstallmentPayment = (id) => api.post(`/fees/installments/${id}/confirm`);
export const rejectInstallmentPayment = (id, payload = {}) => api.post(`/fees/installments/${id}/reject`, payload);
export const reverseInstallmentPayment = (id, payload = {}) => api.post(`/fees/installments/${id}/reverse`, payload);
export const sendFeeReminder = (id) => api.post(`/fees/installments/${id}/reminder`);

export const listAttendance = (params = {}) => api.get('/attendance', { params });
export const createAttendance = (payload) => api.post('/attendance', payload);
export const updateAttendance = (id, payload) => api.patch(`/attendance/${id}`, payload);
export const deleteAttendance = (id) => api.delete(`/attendance/${id}`);

export const listCertificates = (params = {}) => api.get('/certificates', { params });
export const createCertificate = (payload) => api.post('/certificates', payload);
export const updateCertificate = (id, payload) => api.patch(`/certificates/${id}`, payload);
export const deleteCertificate = (id) => api.delete(`/certificates/${id}`);
