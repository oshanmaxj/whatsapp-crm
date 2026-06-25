const { Op } = require('sequelize');
const {
  AttendanceRecord,
  Batch,
  Certificate,
  Contact,
  Course,
  FeeInstallment,
  Lead,
  LeadStatus,
  Student,
  StudentFee,
  User
} = require('../models');
const whatsappService = require('./whatsapp.service');

function fullName(contact) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.phone || 'Student';
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function studentNo() {
  return `STU-${Date.now()}`;
}

function certificateNo() {
  return `CERT-${Date.now()}`;
}

function addMonths(dateString, months) {
  const date = dateString ? new Date(dateString) : new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

class EducationService {
  courseInclude() {
    return [{ model: Batch, as: 'batches', required: false }];
  }

  studentInclude() {
    return [
      { model: Contact, as: 'contact', required: false },
      { model: Lead, as: 'lead', required: false },
      { model: Course, as: 'course', required: false },
      { model: Batch, as: 'batch', required: false },
      { model: StudentFee, as: 'fees', required: false, include: [{ model: FeeInstallment, as: 'installments', required: false }] }
    ];
  }

  async listCourses(query = {}) {
    const where = {};
    if (query.status) where.status = query.status;
    if (query.search) where.name = { [Op.iLike]: `%${query.search}%` };
    return Course.findAll({ where, include: this.courseInclude(), order: [['created_at', 'DESC']] });
  }

  async getCourse(id) {
    const row = await Course.findByPk(id, { include: this.courseInclude() });
    if (!row) throw Object.assign(new Error('Course not found'), { status: 404 });
    return row;
  }

  async createCourse(payload) {
    if (!payload.name) throw Object.assign(new Error('Course name is required'), { status: 400 });
    return Course.create(payload);
  }

  async updateCourse(id, payload) {
    const row = await this.getCourse(id);
    await row.update(payload);
    return this.getCourse(id);
  }

  async deleteCourse(id) {
    const row = await this.getCourse(id);
    await row.destroy();
    return { deleted: true, id };
  }

  async listBatches(query = {}) {
    const where = {};
    if (query.courseId) where.courseId = query.courseId;
    if (query.status) where.status = query.status;
    return Batch.findAll({
      where,
      include: [{ model: Course, as: 'course' }, { model: User, as: 'trainer', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      order: [['created_at', 'DESC']]
    });
  }

  async getBatch(id) {
    const row = await Batch.findByPk(id, { include: [{ model: Course, as: 'course' }, { model: Student, as: 'students' }] });
    if (!row) throw Object.assign(new Error('Batch not found'), { status: 404 });
    return row;
  }

  async createBatch(payload) {
    if (!payload.courseId || !payload.name) throw Object.assign(new Error('Course and batch name are required'), { status: 400 });
    return Batch.create(payload);
  }

  async updateBatch(id, payload) {
    const row = await this.getBatch(id);
    await row.update(payload);
    return this.getBatch(id);
  }

  async deleteBatch(id) {
    const row = await this.getBatch(id);
    await row.destroy();
    return { deleted: true, id };
  }

  async listStudents(query = {}) {
    const where = {};
    if (query.courseId) where.courseId = query.courseId;
    if (query.batchId) where.batchId = query.batchId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${query.search}%` } },
        { phone: { [Op.iLike]: `%${query.search}%` } },
        { studentNo: { [Op.iLike]: `%${query.search}%` } }
      ];
    }
    return Student.findAll({ where, include: this.studentInclude(), order: [['created_at', 'DESC']] });
  }

  async getStudent(id) {
    const row = await Student.findByPk(id, { include: this.studentInclude() });
    if (!row) throw Object.assign(new Error('Student not found'), { status: 404 });
    return row;
  }

  async createStudent(payload) {
    if (!payload.name || !payload.phone) {
      throw Object.assign(new Error('Student name and phone are required'), { status: 400 });
    }
    if (!payload.courseId) {
      throw Object.assign(new Error('Course is required'), { status: 400 });
    }
    let contactId = payload.contactId || null;
    if (!contactId) {
      const [firstName, ...rest] = String(payload.name || '').trim().split(/\s+/).filter(Boolean);
      const [contact] = await Contact.findOrCreate({
        where: { phone: payload.phone },
        defaults: {
          firstName: firstName || payload.name,
          lastName: rest.join(' ') || null,
          phone: payload.phone,
          email: payload.email || null,
          status: 'active'
        }
      });
      if (payload.email && contact.email !== payload.email) {
        await contact.update({ email: payload.email });
      }
      contactId = contact.id;
    }
    return Student.create({
      studentNo: payload.studentNo || studentNo(),
      contactId,
      leadId: payload.leadId || null,
      courseId: payload.courseId || null,
      batchId: payload.batchId || null,
      name: payload.name,
      phone: payload.phone,
      email: payload.email || null,
      status: payload.status || 'enrolled',
      enrolledAt: payload.enrolledAt || new Date(),
      notes: payload.notes || null
    });
  }

  async updateStudent(id, payload) {
    const row = await this.getStudent(id);
    await row.update(payload);
    return this.getStudent(id);
  }

  async deleteStudent(id) {
    const row = await this.getStudent(id);
    await row.destroy();
    return { deleted: true, id };
  }

  async convertLeadToStudent(leadId, payload = {}) {
    const lead = await Lead.findByPk(leadId, { include: [{ model: Contact, as: 'contact' }] });
    if (!lead) throw Object.assign(new Error('Lead not found'), { status: 404 });
    const existing = await Student.findOne({ where: { leadId } });
    if (existing) return this.getStudent(existing.id);

    const student = await this.createStudent({
      contactId: lead.contactId,
      leadId: lead.id,
      courseId: payload.courseId || null,
      batchId: payload.batchId || null,
      name: payload.name || fullName(lead.contact),
      phone: payload.phone || lead.contact?.phone,
      email: payload.email || lead.contact?.email,
      notes: payload.notes || 'Converted from lead'
    });

    const converted = await LeadStatus.findOne({ where: { name: 'Converted' } });
    if (converted) await lead.update({ statusId: converted.id, stage: 'converted' });
    return this.getStudent(student.id);
  }

  async listFees(query = {}) {
    const where = {};
    if (query.studentId) where.studentId = query.studentId;
    if (query.status) where.status = query.status;
    const rows = await StudentFee.findAll({
      where,
      include: [
        { model: Student, as: 'student', include: [{ model: Contact, as: 'contact' }] },
        { model: Course, as: 'course' },
        { model: Batch, as: 'batch' },
        { model: FeeInstallment, as: 'installments' }
      ],
      order: [['created_at', 'DESC']]
    });
    await this.markOverdue(rows);
    return rows;
  }

  async createFee(payload) {
    if (!payload.studentId || payload.totalAmount === undefined) throw Object.assign(new Error('Student and total amount are required'), { status: 400 });
    const student = await this.getStudent(payload.studentId);
    const fee = await StudentFee.create({
      studentId: payload.studentId,
      courseId: payload.courseId || student.courseId || null,
      batchId: payload.batchId || student.batchId || null,
      paymentType: payload.paymentType || 'full',
      totalAmount: payload.totalAmount,
      paidAmount: payload.paidAmount || 0,
      discountAmount: payload.discountAmount || 0,
      dueDate: payload.dueDate || todayDate(),
      notes: payload.notes || null
    });

    if (payload.paymentType === 'installment') {
      const count = Math.max(Number(payload.installmentCount) || 2, 1);
      const amount = Number(payload.totalAmount || 0) / count;
      const rows = Array.from({ length: count }).map((_, index) => ({
        feeId: fee.id,
        installmentNo: index + 1,
        amount,
        dueDate: addMonths(payload.dueDate || todayDate(), index),
        status: 'pending'
      }));
      await FeeInstallment.bulkCreate(rows);
    } else {
      await FeeInstallment.create({ feeId: fee.id, installmentNo: 1, amount: payload.totalAmount, dueDate: payload.dueDate || todayDate() });
    }

    return this.getFee(fee.id);
  }

  async getFee(id) {
    const row = await StudentFee.findByPk(id, { include: [{ model: Student, as: 'student' }, { model: FeeInstallment, as: 'installments' }] });
    if (!row) throw Object.assign(new Error('Fee record not found'), { status: 404 });
    return row;
  }

  async updateFee(id, payload) {
    const row = await this.getFee(id);
    await row.update(payload);
    return this.getFee(id);
  }

  async deleteFee(id) {
    const row = await this.getFee(id);
    await row.destroy();
    return { deleted: true, id };
  }

  async payInstallment(id, payload = {}) {
    const row = await FeeInstallment.findByPk(id, { include: [{ model: StudentFee, as: 'fee' }] });
    if (!row) throw Object.assign(new Error('Installment not found'), { status: 404 });
    const paidAmount = Number(row.paidAmount || 0) + Number(payload.amount || row.amount);
    const status = paidAmount >= Number(row.amount) ? 'paid' : 'partial';
    await row.update({ paidAmount, status, paidAt: status === 'paid' ? new Date() : row.paidAt, notes: payload.notes ?? row.notes });
    const installments = await FeeInstallment.findAll({ where: { feeId: row.feeId } });
    const totalPaid = installments.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
    await row.fee.update({ paidAmount: totalPaid, status: totalPaid >= Number(row.fee.totalAmount) ? 'paid' : 'partial' });
    return this.getFee(row.feeId);
  }

  async markOverdue(fees) {
    const now = todayDate();
    const feeRows = Array.isArray(fees) ? fees : [fees];
    for (const fee of feeRows) {
      for (const item of fee.installments || []) {
        if (item.status !== 'paid' && item.dueDate < now) await item.update({ status: 'overdue' });
      }
    }
  }

  async sendFeeReminder(installmentId) {
    const installment = await FeeInstallment.findByPk(installmentId, {
      include: [{ model: StudentFee, as: 'fee', include: [{ model: Student, as: 'student' }] }]
    });
    if (!installment) throw Object.assign(new Error('Installment not found'), { status: 404 });
    const student = installment.fee.student;
    const text = `Hi ${student.name}, reminder: your fee installment of ${installment.amount} is due on ${installment.dueDate}.`;
    const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
    const notification = realSendEnabled
      ? { mode: 'sent', response: await whatsappService.sendTextMessage({ to: student.phone, text }) }
      : { mode: 'simulated', to: student.phone, text };
    await installment.update({ reminderSentAt: new Date() });
    return { installment, notification };
  }

  async listAttendance(query = {}) {
    const where = {};
    if (query.studentId) where.studentId = query.studentId;
    if (query.batchId) where.batchId = query.batchId;
    if (query.date) where.attendanceDate = query.date;
    return AttendanceRecord.findAll({ where, include: [{ model: Student, as: 'student' }, { model: Course, as: 'course' }, { model: Batch, as: 'batch' }], order: [['attendance_date', 'DESC']] });
  }

  async createAttendance(payload, userId) {
    if (!payload.studentId || !payload.attendanceDate) throw Object.assign(new Error('Student and attendance date are required'), { status: 400 });
    const student = await this.getStudent(payload.studentId);
    return AttendanceRecord.create({
      studentId: payload.studentId,
      courseId: payload.courseId || student.courseId,
      batchId: payload.batchId || student.batchId,
      attendanceDate: payload.attendanceDate,
      status: payload.status || 'present',
      notes: payload.notes || null,
      markedBy: userId || null
    });
  }

  async updateAttendance(id, payload) {
    const row = await AttendanceRecord.findByPk(id);
    if (!row) throw Object.assign(new Error('Attendance record not found'), { status: 404 });
    await row.update(payload);
    return row;
  }

  async deleteAttendance(id) {
    const row = await AttendanceRecord.findByPk(id);
    if (!row) throw Object.assign(new Error('Attendance record not found'), { status: 404 });
    await row.destroy();
    return { deleted: true, id };
  }

  async listCertificates(query = {}) {
    const where = {};
    if (query.studentId) where.studentId = query.studentId;
    if (query.status) where.status = query.status;
    return Certificate.findAll({ where, include: [{ model: Student, as: 'student' }, { model: Course, as: 'course' }, { model: Batch, as: 'batch' }], order: [['created_at', 'DESC']] });
  }

  async createCertificate(payload, userId) {
    if (!payload.studentId) throw Object.assign(new Error('Student is required'), { status: 400 });
    const student = await this.getStudent(payload.studentId);
    return Certificate.create({
      certificateNo: payload.certificateNo || certificateNo(),
      studentId: payload.studentId,
      courseId: payload.courseId || student.courseId,
      batchId: payload.batchId || student.batchId,
      issuedAt: payload.issuedAt || null,
      status: payload.status || 'draft',
      certificateUrl: payload.certificateUrl || null,
      notes: payload.notes || null,
      issuedBy: userId || null
    });
  }

  async updateCertificate(id, payload) {
    const row = await Certificate.findByPk(id);
    if (!row) throw Object.assign(new Error('Certificate not found'), { status: 404 });
    await row.update(payload);
    return row;
  }

  async deleteCertificate(id) {
    const row = await Certificate.findByPk(id);
    if (!row) throw Object.assign(new Error('Certificate not found'), { status: 404 });
    await row.destroy();
    return { deleted: true, id };
  }
}

module.exports = new EducationService();
