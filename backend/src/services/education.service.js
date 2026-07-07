const { Op } = require('sequelize');
const crypto = require('crypto');
const {
  AttendanceRecord,
  AccountingCategory,
  AccountingTransaction,
  AppSetting,
  Batch,
  Certificate,
  Contact,
  Conversation,
  Course,
  FeeInstallment,
  Lead,
  LeadSource,
  LeadStatus,
  Message,
  Student,
  StudentDocument,
  StudentEnrollment,
  StudentFee,
  StudentGuardian,
  StudentNote,
  User,
  sequelize
} = require('../models');
const whatsappService = require('./whatsapp.service');
const notificationTemplateService = require('./notificationTemplate.service');
const logger = require('../config/logger');
const { canConfirmPayment } = require('../utils/paymentConfirmationAccess');
const studentMessageAutomationService = require('./studentMessageAutomation.service');
const { evaluateFeeAccess } = require('./enrollmentAccess.service');

function fullName(contact) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.phone || 'Student';
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function studentNo() {
  return `STU-${Date.now()}`;
}

function registrationNumber(student) {
  return student?.registrationNo || student?.registrationNumber || student?.studentNo || student?.admissionNo || null;
}

function optionalId(value) {
  return value === '' || value === undefined || value === null ? null : value;
}

function normalizeCoursePayload(payload) {
  const next = { ...payload };
  if (next.defaultInstallmentCount === '' || next.defaultInstallmentCount === undefined || next.defaultInstallmentCount === null) {
    next.defaultInstallmentCount = 1;
  }
  next.defaultInstallmentCount = Number(next.defaultInstallmentCount);
  if (!Number.isFinite(next.defaultInstallmentCount) || next.defaultInstallmentCount < 1) {
    throw Object.assign(new Error('Default installment count must be at least 1.'), { status: 400 });
  }
  return next;
}

function certificateNo() {
  return `CERT-${Date.now()}`;
}

function addMonths(dateString, months) {
  const date = dateString ? new Date(dateString) : new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function amount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((amount(value) + Number.EPSILON) * 100) / 100;
}

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function feeStatus(totalAmount, paidAmount, paymentType) {
  if (paymentType === 'free_card') return 'free';
  if (amount(totalAmount) <= 0) return 'paid';
  if (amount(paidAmount) >= amount(totalAmount)) return 'paid';
  if (amount(paidAmount) > 0) return 'partial';
  return 'pending';
}

function serialize(model) {
  return model && typeof model.toJSON === 'function' ? model.toJSON() : model;
}

function feeDisplayStatus(fee, nextInstallment) {
  if (!fee) return 'Pending';
  if (fee.paymentType === 'free_card' || fee.status === 'free') return 'Free Card';
  if (fee.paymentType === 'scholarship' || fee.discountType === 'scholarship') return 'Scholarship';
  if (fee.status === 'paid') return 'Paid';
  if (fee.status === 'overdue' || nextInstallment?.status === 'overdue') return 'Overdue';
  if (fee.status === 'partial' || amount(fee.paidAmount) > 0) return 'Partial';
  return 'Pending';
}

function calculateDiscount({ originalAmount, discountType, discountValue, paymentType, discountReason, approvedBy }) {
  const original = Math.max(roundMoney(originalAmount), 0);
  const type = paymentType === 'free_card' ? 'fixed' : discountType || 'none';
  const value = Math.max(amount(paymentType === 'free_card' ? original : discountValue), 0);

  if (type === 'special_approval' && (!cleanText(discountReason) || !cleanText(approvedBy))) {
    throw Object.assign(new Error('Special approval discounts require a reason and approver.'), { status: 400 });
  }

  if (['fixed', 'promotional', 'special_approval'].includes(type) && value > original) {
    throw Object.assign(new Error('Fixed discount cannot exceed original amount.'), { status: 400 });
  }

  if (type === 'percentage' && value > 100) {
    throw Object.assign(new Error('Percentage discount cannot exceed 100%.'), { status: 400 });
  }

  let discount = 0;
  if (type === 'fixed' || type === 'promotional' || type === 'special_approval' || type === 'scholarship') discount = value;
  if (type === 'percentage') discount = original * value / 100;
  if (type === 'none') discount = 0;

  if (discount > original) {
    if (type !== 'scholarship') throw Object.assign(new Error('Discount cannot exceed original amount.'), { status: 400 });
    discount = original;
  }

  return {
    discountType: paymentType === 'free_card' ? 'scholarship' : type,
    discountValue: roundMoney(value),
    discountAmount: roundMoney(discount),
    totalAmount: roundMoney(Math.max(original - discount, 0))
  };
}

function splitInstallments(totalAmount, count) {
  const safeCount = Math.max(Number(count) || 1, 1);
  const cents = Math.round(amount(totalAmount) * 100);
  const base = Math.floor(cents / safeCount);
  let remainder = cents - base * safeCount;
  return Array.from({ length: safeCount }).map(() => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return (base + extra) / 100;
  });
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
      {
        model: StudentEnrollment,
        as: 'enrollments',
        required: false,
        include: [
          { model: Course, as: 'course', required: false },
          { model: Batch, as: 'batch', required: false }
        ]
      },
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
    return Course.create(normalizeCoursePayload(payload));
  }

  async updateCourse(id, payload) {
    const row = await this.getCourse(id);
    await row.update(normalizeCoursePayload({ ...row.toJSON(), ...payload }));
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
    if (query.courseId) where['$enrollments.course_id$'] = query.courseId;
    if (query.batchId) where['$enrollments.batch_id$'] = query.batchId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${query.search}%` } },
        { phone: { [Op.iLike]: `%${query.search}%` } },
        { studentNo: { [Op.iLike]: `%${query.search}%` } }
      ];
    }
    return Student.findAll({ where, include: this.studentInclude(), order: [['created_at', 'DESC']], distinct: true });
  }

  async getStudent(id) {
    const row = await Student.findByPk(id, { include: this.studentInclude() });
    if (!row) throw Object.assign(new Error('Student not found'), { status: 404 });
    return row;
  }

  async getStudentProfile(id) {
    const student = await Student.findByPk(id, {
      include: [
        { model: Contact, as: 'contact', required: false },
        { model: Lead, as: 'lead', required: false },
        { model: Course, as: 'course', required: false },
        { model: Batch, as: 'batch', required: false, include: [{ model: User, as: 'trainer', attributes: ['id', 'firstName', 'lastName', 'email'] }] },
        {
          model: StudentEnrollment,
          as: 'enrollments',
          required: false,
          include: [
            { model: Course, as: 'course', required: false },
            { model: Batch, as: 'batch', required: false, include: [{ model: User, as: 'trainer', attributes: ['id', 'firstName', 'lastName', 'email'] }] }
          ]
        },
        { model: StudentFee, as: 'fees', required: false, include: [{ model: FeeInstallment, as: 'installments', required: false }] },
        { model: AttendanceRecord, as: 'attendance', required: false },
        { model: Certificate, as: 'certificates', required: false },
        { model: StudentNote, as: 'profileNotes', required: false, include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] }] },
        { model: StudentDocument, as: 'documents', required: false, include: [{ model: User, as: 'uploader', attributes: ['id', 'firstName', 'lastName', 'email'] }] },
        { model: StudentGuardian, as: 'guardians', required: false }
      ]
    });
    if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });

    const data = serialize(student);
    data.enrollments = (data.enrollments || []).map((enrollment) => {
      const enrollmentFee = (data.fees || []).find((item) => (
        String(item.enrollmentId || '') === String(enrollment.id)
        || (!item.enrollmentId
          && String(item.courseId) === String(enrollment.courseId)
          && String(item.batchId || '') === String(enrollment.batchId || ''))
      ));
      const access = evaluateFeeAccess(enrollmentFee, enrollmentFee?.installments || []);
      return {
        ...enrollment,
        paymentStatus: access.paymentStatus,
        accessAllowed: enrollment.enrollmentStatus === 'active' && access.accessAllowed,
        accessReason: enrollment.enrollmentStatus === 'active' ? access.reason : 'enrollment_not_active'
      };
    });
    const fees = [...(student.fees || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const fee = fees[0] || null;
    if (fee) await this.markOverdue(fee);
    const installments = [...(fee?.installments || [])].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.installmentNo - b.installmentNo);
    const nextInstallment = installments.find((item) => !['paid', 'cancelled'].includes(item.status));
    const attendanceRows = data.attendance || [];
    const attended = attendanceRows.filter((item) => ['present', 'late'].includes(item.status)).length;
    const absent = attendanceRows.filter((item) => item.status === 'absent').length;
    const totalClasses = attendanceRows.length;
    const conversations = await Conversation.findAll({
      where: {
        [Op.or]: [
          { contactId: student.contactId },
          ...(student.leadId ? [{ leadId: student.leadId }] : [])
        ]
      },
      order: [['last_message_at', 'DESC'], ['updated_at', 'DESC']]
    });
    const lastConversation = conversations[0] || null;
    const conversationIds = conversations.map((item) => item.id);
    const lastMessage = await Message.findOne({
      where: {
        [Op.or]: [
          { contactId: student.contactId },
          ...(conversationIds.length ? [{ conversationId: { [Op.in]: conversationIds } }] : [])
        ]
      },
      order: [['created_at', 'DESC']]
    });

    return {
      student: {
        id: data.id,
        fullName: data.name,
        studentId: data.studentNo,
        nic: data.nic || data.contact?.nic || null,
        phone: data.phone,
        whatsappNumber: data.contact?.whatsappId || data.phone,
        email: data.email || data.contact?.email || null,
        dateOfBirth: data.dateOfBirth || null,
        address: data.address || data.contact?.address || null,
        registrationDate: data.enrolledAt,
        status: data.status,
        photo: data.photoUrl || data.contact?.photoUrl || null,
        raw: data
      },
      course: data.course ? {
        id: data.course.id,
        name: data.course.name,
        fee: data.course.feeAmount,
        code: data.course.code,
        category: data.course.category
      } : {},
      batch: data.batch ? {
        id: data.batch.id,
        name: data.batch.name,
        startDate: data.batch.startDate,
        endDate: data.batch.endDate,
        lecturer: [data.batch.trainer?.firstName, data.batch.trainer?.lastName].filter(Boolean).join(' ') || data.batch.trainer?.email || null,
        schedule: data.batch.schedule,
        status: data.batch.status
      } : {},
      fees: fee ? {
        id: fee.id,
        originalFee: fee.originalAmount,
        discount: fee.discountAmount,
        finalFee: fee.totalAmount,
        paidAmount: fee.paidAmount,
        balance: fee.balance,
        nextInstallmentDate: nextInstallment?.dueDate || null,
        paymentStatus: feeDisplayStatus(fee, nextInstallment),
        raw: serialize(fee)
      } : {},
      installments: installments.map((item) => ({
        id: item.id,
        date: item.paidDate || item.dueDate,
        amount: item.amount,
        method: item.paymentMethod,
        reference: item.transactionReference,
        status: item.status,
        dueDate: item.dueDate,
        paidAmount: item.paidAmount
      })),
      attendance: {
        totalClasses,
        attended,
        absent,
        attendancePercentage: totalClasses ? roundMoney((attended / totalClasses) * 100) : 0,
        records: attendanceRows
      },
      certificates: data.certificates || [],
      notes: data.profileNotes || [],
      whatsapp: {
        lastConversationDate: lastConversation?.lastMessageAt || lastConversation?.updatedAt || null,
        totalConversations: conversations.length,
        lastMessagePreview: lastMessage?.text || lastConversation?.summary || null,
        contactId: student.contactId,
        conversationId: lastConversation?.id || null
      },
      documents: data.documents || [],
      guardians: data.guardians || []
      ,
      enrollments: (data.enrollments || []).sort((a, b) => new Date(b.enrolledAt) - new Date(a.enrolledAt))
    };
  }

  normalizeEnrollments(payload = {}) {
    const source = Array.isArray(payload.enrollments) && payload.enrollments.length
      ? payload.enrollments
      : (payload.courseId || payload.course_id)
        ? [{
          courseId: payload.courseId || payload.course_id,
          batchId: payload.batchId || payload.batch_id || null,
          status: 'active',
          feePlan: payload.feePlan || payload.fee_plan || payload.paymentType || payload.payment_type || 'full',
          installments: payload.installments || payload.installmentCount || payload.installment_count || 1
        }]
        : [];
    return source.map((item) => ({
      id: optionalId(item.id),
      courseId: optionalId(item.courseId || item.course_id),
      batchId: optionalId(item.batchId || item.batch_id),
      enrollmentStatus: item.status || item.enrollmentStatus || item.enrollment_status || 'active',
      feePlan: item.feePlan || item.fee_plan || item.paymentType || item.payment_type || 'full',
      installments: Number(item.installments || item.installmentCount || item.installment_count || 1),
      enrolledAt: item.enrolledAt || new Date(),
      completedAt: item.completedAt || null
    }));
  }

  async validateEnrollments(enrollments) {
    if (!enrollments.length) throw Object.assign(new Error('At least one enrollment is required'), { status: 400 });
    const activeKeys = new Set();
    for (const enrollment of enrollments) {
      if (!enrollment.courseId) throw Object.assign(new Error('Every enrollment requires a course'), { status: 400 });
      if (!['active', 'completed', 'suspended', 'cancelled', 'expired'].includes(enrollment.enrollmentStatus)) {
        throw Object.assign(new Error('Invalid enrollment status'), { status: 400 });
      }
      if (!['full', 'installment', 'free_card', 'scholarship'].includes(enrollment.feePlan)) {
        throw Object.assign(new Error('Invalid enrollment fee plan'), { status: 400 });
      }
      if (!Number.isInteger(enrollment.installments) || enrollment.installments < 1) {
        throw Object.assign(new Error('Enrollment installments must be at least 1'), { status: 400 });
      }
      const [course, batch] = await Promise.all([
        Course.findByPk(enrollment.courseId),
        enrollment.batchId ? Batch.findByPk(enrollment.batchId) : null
      ]);
      if (!course) throw Object.assign(new Error('Enrollment course not found'), { status: 400 });
      if (enrollment.batchId && (!batch || String(batch.courseId) !== String(enrollment.courseId))) {
        throw Object.assign(new Error('Enrollment batch must belong to its selected course'), { status: 400 });
      }
      if (enrollment.enrollmentStatus === 'active') {
        const key = `${enrollment.courseId}:${enrollment.batchId || 'none'}`;
        if (activeKeys.has(key)) throw Object.assign(new Error('Duplicate active enrollment for the same course and batch'), { status: 409 });
        activeKeys.add(key);
      }
    }
  }

  async syncEnrollments(student, payload, userId = null) {
    if (!Object.prototype.hasOwnProperty.call(payload, 'enrollments') && !payload.courseId) return;
    const enrollments = this.normalizeEnrollments(payload);
    await this.validateEnrollments(enrollments);
    const existing = await StudentEnrollment.findAll({ where: { studentId: student.id } });
    const submittedIds = new Set(enrollments.filter((item) => item.id).map((item) => String(item.id)));
    for (const row of existing) {
      if (!submittedIds.has(String(row.id)) && row.enrollmentStatus === 'active') {
        await row.update({ enrollmentStatus: 'cancelled', completedAt: null });
      }
    }
    for (const enrollment of enrollments) {
      const values = {
        courseId: enrollment.courseId,
        batchId: enrollment.batchId,
        enrollmentStatus: enrollment.enrollmentStatus,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.enrollmentStatus === 'completed' ? enrollment.completedAt || new Date() : null
      };
      if (enrollment.id) {
        const row = existing.find((item) => String(item.id) === String(enrollment.id));
        if (!row) throw Object.assign(new Error('Student enrollment not found'), { status: 404 });
        await row.update(values);
      } else {
        const duplicate = existing.find((item) => (
          item.enrollmentStatus === 'active'
          && enrollment.enrollmentStatus === 'active'
          && String(item.courseId) === String(enrollment.courseId)
          && String(item.batchId || '') === String(enrollment.batchId || '')
        ));
        if (duplicate) throw Object.assign(new Error('Duplicate active enrollment for the same course and batch'), { status: 409 });
        await StudentEnrollment.create({ studentId: student.id, createdBy: userId, ...values });
      }
    }
    const primary = enrollments.find((item) => item.enrollmentStatus === 'active') || enrollments[0];
    await student.update({ courseId: primary?.courseId || null, batchId: primary?.batchId || null });
  }

  async listStudentEnrollments(studentId) {
    await this.getStudent(studentId);
    return StudentEnrollment.findAll({
      where: { studentId },
      include: [
        { model: Course, as: 'course', required: false },
        { model: Batch, as: 'batch', required: false },
        { model: StudentFee, as: 'fees', required: false, include: [{ model: FeeInstallment, as: 'installments', required: false }] }
      ],
      order: [['enrolled_at', 'DESC']]
    });
  }

  async createStudentEnrollment(studentId, payload, userId = null) {
    const student = await this.getStudent(studentId);
    const [values] = this.normalizeEnrollments({ enrollments: [payload] });
    await this.validateEnrollments([values]);
    const duplicate = await StudentEnrollment.findOne({
      where: {
        studentId,
        courseId: values.courseId,
        batchId: values.batchId,
        enrollmentStatus: 'active'
      }
    });
    if (duplicate && values.enrollmentStatus === 'active') {
      throw Object.assign(new Error('Duplicate active enrollment for the same course and batch'), { status: 409 });
    }
    const enrollment = await StudentEnrollment.create({
      studentId, createdBy: userId, ...values,
      completedAt: values.enrollmentStatus === 'completed' ? values.completedAt || new Date() : null
    });
    if (!student.courseId || values.enrollmentStatus === 'active') {
      await student.update({ courseId: values.courseId, batchId: values.batchId });
    }
    await studentMessageAutomationService.dispatchEnrollmentWelcome(enrollment.id, {
      createdBy: userId,
      portalPassword: payload.portalPassword || ''
    }).catch((error) => logger.warn('enrollment_welcome_queue_failed', { enrollmentId: enrollment.id, error: error.message }));
    return StudentEnrollment.findByPk(enrollment.id, {
      include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }]
    });
  }

  async updateEnrollment(id, payload) {
    const row = await StudentEnrollment.findByPk(id);
    if (!row) throw Object.assign(new Error('Student enrollment not found'), { status: 404 });
    const [values] = this.normalizeEnrollments({ enrollments: [{ ...row.toJSON(), ...payload, id }] });
    await this.validateEnrollments([values]);
    if (values.enrollmentStatus === 'active') {
      const duplicate = await StudentEnrollment.findOne({
        where: {
          id: { [Op.ne]: row.id },
          studentId: row.studentId,
          courseId: values.courseId,
          batchId: values.batchId,
          enrollmentStatus: 'active'
        }
      });
      if (duplicate) throw Object.assign(new Error('Duplicate active enrollment for the same course and batch'), { status: 409 });
    }
    await row.update({
      courseId: values.courseId,
      batchId: values.batchId,
      enrollmentStatus: values.enrollmentStatus,
      enrolledAt: values.enrolledAt,
      completedAt: values.enrollmentStatus === 'completed' ? values.completedAt || new Date() : null
    });
    return row.reload({ include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }] });
  }

  async deleteEnrollment(id) {
    const row = await StudentEnrollment.findByPk(id);
    if (!row) throw Object.assign(new Error('Student enrollment not found'), { status: 404 });
    await row.update({ enrollmentStatus: 'cancelled', completedAt: null });
    return { deleted: true, id: row.id, retainedForHistory: true };
  }

  async createStudent(payload, userId = null) {
    const name = String(payload.name || '').trim();
    const phone = String(payload.phone || '').trim();
    const email = String(payload.email || '').trim() || null;
    const portalPassword = payload.studentPortalPassword ?? payload.portalPassword;

    if (!name || !phone) {
      throw Object.assign(new Error('Student name and phone are required'), { status: 400 });
    }
    if (portalPassword && String(portalPassword).length < 8) {
      throw Object.assign(new Error('Student portal password must be at least 8 characters'), { status: 400 });
    }

    let contactId = optionalId(payload.contactId);
    if (!contactId) {
      const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
      let contact = await Contact.findOne({ where: { phone }, paranoid: false });
      if (contact?.deletedAt) {
        await contact.restore();
      }
      if (!contact) {
        contact = await Contact.create({
          firstName: firstName || name,
          lastName: rest.join(' ') || null,
          phone,
          email,
          status: 'active'
        });
      } else if (email && contact.email !== email) {
        await contact.update({ email });
      }
      contactId = contact.id;
    }

    const generatedPortalPassword = portalPassword ? null : `Stu-${crypto.randomBytes(5).toString('base64url')}`;
    const initialEnrollments = this.normalizeEnrollments(payload);
    await this.validateEnrollments(initialEnrollments);
    const primaryEnrollment = initialEnrollments.find((item) => item.enrollmentStatus === 'active') || initialEnrollments[0];
    const student = await Student.create({
      studentNo: payload.studentNo || studentNo(),
      contactId,
      leadId: optionalId(payload.leadId),
      courseId: primaryEnrollment?.courseId || null,
      batchId: primaryEnrollment?.batchId || null,
      name,
      phone,
      email,
      dateOfBirth: payload.dateOfBirth || null,
      status: payload.status || 'enrolled',
      enrolledAt: payload.enrolledAt || new Date(),
      notes: payload.notes || null,
      portalPasswordHash: portalPassword || generatedPortalPassword
    });
    await this.syncEnrollments(student, { enrollments: initialEnrollments }, userId);
    const createdEnrollments = await StudentEnrollment.findAll({ where: { studentId: student.id } });
    for (const enrollment of initialEnrollments.filter((item) => item.enrollmentStatus === 'active')) {
      const createdEnrollment = createdEnrollments.find((item) => (
        String(item.courseId) === String(enrollment.courseId)
        && String(item.batchId || '') === String(enrollment.batchId || '')
      ));
      if (createdEnrollment) {
        await this.createFee({
          studentId: student.id,
          enrollmentId: createdEnrollment.id,
          courseId: enrollment.courseId,
          batchId: enrollment.batchId,
          paymentType: enrollment.feePlan,
          installmentCount: enrollment.installments,
          notes: payload.notes || null
        }, userId ? { id: userId } : null);
      }
    }
    await Promise.all(createdEnrollments.map((enrollment) => studentMessageAutomationService.dispatchEnrollmentWelcome(enrollment.id, {
      createdBy: userId,
      portalPassword: portalPassword || generatedPortalPassword || ''
    }).catch((error) => logger.warn('enrollment_welcome_queue_failed', { enrollmentId: enrollment.id, error: error.message }))));
    const created = serialize(await this.getStudent(student.id));
    if (generatedPortalPassword) created.generatedPortalPassword = generatedPortalPassword;
    await studentMessageAutomationService.dispatch('student_welcome', student.id, {
      eventId: `student:${student.id}`,
      eventDate: new Date().toISOString().slice(0, 10),
      portalPassword: portalPassword || generatedPortalPassword || ''
    }).catch((error) => logger.warn('student_welcome_queue_failed', { studentId: student.id, error: error.message }));
    if (process.env.LMS_GUIDE_AUTOMATION_ENABLED !== 'false') {
      await studentMessageAutomationService.dispatch('lms_user_guide', student.id, {
        eventId: `student:${student.id}`,
        eventDate: new Date().toISOString().slice(0, 10),
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000)
      }).catch((error) => logger.warn('lms_guide_queue_failed', { studentId: student.id, error: error.message }));
    }
    return created;
  }

  async updateStudent(id, payload, userId = null) {
    const row = await this.getStudent(id);
    const next = { ...payload };
    const portalPassword = next.studentPortalPassword ?? next.portalPassword;
    if (portalPassword && String(portalPassword).length < 8) {
      throw Object.assign(new Error('Student portal password must be at least 8 characters'), { status: 400 });
    }
    delete next.portalPasswordHash;
    if (portalPassword) {
      next.portalPasswordHash = portalPassword;
    }
    delete next.portalPassword;
    delete next.studentPortalPassword;
    delete next.enrollments;
    if ('courseId' in next) next.courseId = optionalId(next.courseId);
    if ('batchId' in next) next.batchId = optionalId(next.batchId);
    if ('leadId' in next) next.leadId = optionalId(next.leadId);
    await row.update(next);
    if (Object.prototype.hasOwnProperty.call(payload, 'enrollments')) await this.syncEnrollments(row, payload, userId);
    return this.getStudent(id);
  }

  async resetStudentPortalPassword(id, payload = {}) {
    const row = await this.getStudent(id);
    const generated = !String(payload.password || '').trim();
    const password = generated ? `Stu-${crypto.randomBytes(5).toString('base64url')}` : String(payload.password).trim();
    if (password.length < 8) throw Object.assign(new Error('Student portal password must be at least 8 characters'), { status: 400 });
    await row.update({ portalPasswordHash: password });
    return { studentId: row.id, studentNo: row.studentNo, generatedPassword: generated ? password : null };
  }

  async deleteStudent(id) {
    const row = await this.getStudent(id);
    await row.destroy();
    return { deleted: true, id };
  }

  async convertLeadToStudent(leadId, payload = {}, userId = null) {
    const lead = await Lead.findByPk(leadId, {
      include: [
        { model: Contact, as: 'contact' },
        { model: LeadSource, as: 'source', required: false }
      ]
    });
    if (!lead) throw Object.assign(new Error('Lead not found'), { status: 404 });
    const existing = await Student.findOne({ where: { leadId } });
    if (existing) return this.studentConversionPayload(await this.getStudent(existing.id));

    let courseId = optionalId(payload.courseId || payload.course_id);
    if (!courseId && lead.courseInterested) {
      const course = await Course.findOne({
        where: {
          [Op.or]: [
            { name: { [Op.iLike]: String(lead.courseInterested).trim() } },
            { code: { [Op.iLike]: String(lead.courseInterested).trim() } }
          ]
        }
      });
      courseId = course?.id || null;
    }
    let batchId = optionalId(payload.batchId || payload.batch_id);
    if (!batchId && lead.batchInterested) {
      const batch = await Batch.findOne({
        where: {
          ...(courseId ? { courseId } : {}),
          [Op.or]: [
            { name: { [Op.iLike]: String(lead.batchInterested).trim() } },
            { code: { [Op.iLike]: String(lead.batchInterested).trim() } }
          ]
        }
      });
      batchId = batch?.id || null;
    }
    const leadNotes = [
      payload.notes,
      !payload.notes && lead.notes ? lead.notes : null,
      lead.source?.name ? `Lead source: ${lead.source.name}` : null
    ].filter(Boolean).join('\n');

    const student = await this.createStudent({
      contactId: lead.contactId,
      leadId: lead.id,
      courseId,
      batchId,
      enrollments: payload.enrollments,
      name: payload.name || fullName(lead.contact),
      phone: payload.phone || lead.contact?.phone,
      email: payload.email || lead.contact?.email,
      dateOfBirth: payload.dateOfBirth || payload.date_of_birth || null,
      status: payload.status || 'enrolled',
      studentPortalPassword: payload.studentPortalPassword ?? payload.portalPassword ?? null,
      notes: leadNotes || 'Converted from lead'
    }, userId);

    const converted = await LeadStatus.findOne({ where: { name: 'Converted' } });
    if (converted) await lead.update({ statusId: converted.id, stage: 'converted' });
    const convertedStudent = this.studentConversionPayload(await this.getStudent(student.id));
    if (student.generatedPortalPassword) convertedStudent.generatedPortalPassword = student.generatedPortalPassword;
    return convertedStudent;
  }

  studentConversionPayload(student) {
    const data = serialize(student);
    return {
      ...data,
      registration_no: registrationNumber(data),
      course_id: data.courseId || null,
      batch_id: data.batchId || null
    };
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

  async feePayload(payload, existing = null) {
    const requestedStudentId = payload.studentId || payload.student_id || existing?.studentId;
    if (!requestedStudentId) throw Object.assign(new Error('Student is required'), { status: 400 });
    const student = await this.getStudent(requestedStudentId);
    if (!registrationNumber(student)) await student.update({ studentNo: studentNo() });
    const requestedEnrollmentId = optionalId(payload.enrollmentId || payload.enrollment_id);
    const selectedEnrollment = requestedEnrollmentId
      ? (student.enrollments || []).find((item) => String(item.id) === String(requestedEnrollmentId) && item.enrollmentStatus === 'active')
      : null;
    if (requestedEnrollmentId && !selectedEnrollment) {
      throw Object.assign(new Error('An active student enrollment is required for this fee'), { status: 400 });
    }
    const courseId = selectedEnrollment?.courseId || optionalId(payload.courseId || payload.course_id) || existing?.courseId || student.courseId || null;
    const batchId = selectedEnrollment?.batchId ?? optionalId(payload.batchId || payload.batch_id) ?? existing?.batchId ?? student.batchId ?? null;
    const matchingEnrollment = (student.enrollments || []).find((item) => (
      item.enrollmentStatus === 'active'
      && String(item.courseId) === String(courseId)
      && String(item.batchId || '') === String(batchId || '')
    ));
    if (!matchingEnrollment) throw Object.assign(new Error('Fee course and batch must match an active student enrollment'), { status: 400 });
    const course = courseId ? await Course.findByPk(courseId) : student.course;
    const paymentType = payload.paymentType || existing?.paymentType || 'full';
    const courseAmount = amount(course?.feeAmount);
    const originalAmount = payload.originalAmount !== undefined && payload.originalAmount !== null
      ? amount(payload.originalAmount)
      : amount(existing?.originalAmount || courseAmount || payload.totalAmount);

    if (paymentType !== 'free_card' && originalAmount < 0) {
      throw Object.assign(new Error('Original amount must be greater than or equal to 0.'), { status: 400 });
    }

    const requestedCount = paymentType === 'full' || paymentType === 'free_card'
      ? 1
      : (payload.installmentCount || existing?.installmentCount || course?.defaultInstallmentCount || 1);
    const installmentCount = Math.max(Number(requestedCount) || 1, 1);
    const discount = calculateDiscount({
      originalAmount,
      discountType: payload.discountType || existing?.discountType || 'none',
      discountValue: payload.discountValue ?? existing?.discountValue ?? 0,
      paymentType,
      discountReason: payload.discountReason ?? existing?.discountReason,
      approvedBy: payload.approvedBy ?? existing?.approvedBy
    });
    // Payments must enter through the installment approval workflow. Existing
    // totals are preserved while editing an unpaid plan, but API callers cannot
    // create an already-paid fee record.
    const paidAmount = paymentType === 'free_card' ? 0 : Math.min(amount(existing?.paidAmount), discount.totalAmount);
    const balance = roundMoney(Math.max(discount.totalAmount - paidAmount, 0));

    return {
      studentId: student.id,
      enrollmentId: matchingEnrollment.id,
      courseId,
      batchId,
      originalAmount: roundMoney(originalAmount),
      discountType: discount.discountType,
      discountValue: discount.discountValue,
      discountAmount: discount.discountAmount,
      discountReason: cleanText(payload.discountReason ?? existing?.discountReason),
      approvedBy: cleanText(payload.approvedBy ?? existing?.approvedBy),
      approvedAt: cleanText(payload.approvedBy ?? existing?.approvedBy) ? (existing?.approvedAt || new Date()) : null,
      paymentType,
      installmentCount,
      totalAmount: discount.totalAmount,
      paidAmount,
      balance,
      status: feeStatus(discount.totalAmount, paidAmount, paymentType),
      dueDate: payload.dueDate || existing?.dueDate || todayDate(),
      notes: payload.notes ?? existing?.notes ?? null
    };
  }

  async replaceInstallments(fee, feeData, payload = {}) {
    await FeeInstallment.destroy({ where: { studentFeeId: fee.id } });
    if (feeData.paymentType === 'free_card') return;
    const count = feeData.paymentType === 'installment' ? feeData.installmentCount : 1;
    const amounts = splitInstallments(feeData.totalAmount, count);
    const paidAmount = amount(feeData.paidAmount);
    let remainingPaid = paidAmount;
    const rows = amounts.map((installmentAmount, index) => {
      const appliedPaid = Math.min(remainingPaid, installmentAmount);
      remainingPaid = roundMoney(remainingPaid - appliedPaid);
      return {
        studentFeeId: fee.id,
        installmentNo: index + 1,
        amount: installmentAmount,
        paidAmount: appliedPaid,
        dueDate: addMonths(feeData.dueDate || todayDate(), index),
        paidDate: appliedPaid >= installmentAmount ? (payload.paidDate || todayDate()) : null,
        paymentMethod: payload.paymentMethod || (feeData.paymentType === 'scholarship' ? 'Scholarship' : null),
        transactionReference: payload.transactionReference || null,
        status: appliedPaid >= installmentAmount ? 'paid' : appliedPaid > 0 ? 'partially_paid' : 'pending',
        notes: payload.notes || null
      };
    });
    await FeeInstallment.bulkCreate(rows);
  }

  async recalculateFee(feeId) {
    const fee = await StudentFee.findByPk(feeId, { include: [{ model: FeeInstallment, as: 'installments' }] });
    if (!fee) throw Object.assign(new Error('Fee record not found'), { status: 404 });
    const paidAmount = roundMoney((fee.installments || []).reduce((sum, item) => sum + amount(item.paidAmount), 0));
    const balance = roundMoney(Math.max(amount(fee.totalAmount) - paidAmount, 0));
    await fee.update({ paidAmount, balance, status: feeStatus(fee.totalAmount, paidAmount, fee.paymentType) });
    return this.getFee(feeId);
  }

  async createFee(payload, user = null) {
    const feeData = await this.feePayload(payload);
    const fee = await StudentFee.create(feeData);
    await this.replaceInstallments(fee, feeData, payload);
    let savedFee = await this.getFee(fee.id);
    const paymentAmount = roundMoney(payload.paymentAmount ?? payload.payment_amount ?? payload.paidAmount ?? payload.paid_amount);
    if (paymentAmount <= 0 || feeData.paymentType === 'free_card') {
      return {
        fee: savedFee,
        payment: null,
        paymentStatus: feeData.paymentType === 'free_card' ? 'confirmed' : 'not_recorded',
        incomeCreated: false,
        message: 'Fee added.'
      };
    }

    const installment = [...(savedFee.installments || [])].sort((a, b) => a.installmentNo - b.installmentNo)[0];
    if (!installment) throw Object.assign(new Error('No payable installment was created for this fee.'), { status: 409 });
    const paymentResult = await this.payInstallment(installment.id, {
      amount: paymentAmount,
      paymentMethod: payload.paymentMethod || payload.payment_method || 'Cash',
      transactionReference: payload.transactionReference || payload.transaction_reference || null,
      paidDate: payload.paidDate || payload.paid_date || todayDate(),
      notes: payload.paymentNotes || payload.payment_notes || payload.notes || null
    }, user?.id || null);

    if (canConfirmPayment(user)) {
      const confirmation = await this.confirmInstallmentPayment(installment.id, user?.id || null);
      return {
        fee: confirmation.fee,
        payment: confirmation.fee.installments.find((item) => String(item.id) === String(installment.id)) || null,
        paymentStatus: 'confirmed',
        incomeCreated: true,
        accountingTransactionId: confirmation.accountingTransactionId,
        notification: confirmation.notification,
        message: 'Fee added and income recorded.'
      };
    }

    savedFee = paymentResult.fee;
    return {
      fee: savedFee,
      payment: paymentResult.payment,
      paymentStatus: 'pending_confirmation',
      incomeCreated: false,
      message: 'Fee added. Waiting for payment confirmation.'
    };
  }

  async getFee(id) {
    const row = await StudentFee.findByPk(id, {
      include: [
        { model: Student, as: 'student', include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch' }] },
        { model: Course, as: 'course' },
        { model: Batch, as: 'batch' },
        { model: FeeInstallment, as: 'installments' }
      ]
    });
    if (!row) throw Object.assign(new Error('Fee record not found'), { status: 404 });
    return row;
  }

  async updateFee(id, payload) {
    const row = await this.getFee(id);
    if ((row.installments || []).some((item) => amount(item.paidAmount) > 0 || item.accountingTransactionId || item.status === 'pending_confirmation')) {
      throw Object.assign(new Error('A fee plan with recorded or pending payments cannot be restructured.'), { status: 409 });
    }
    const next = await this.feePayload({ ...row.toJSON(), ...payload, studentId: payload.studentId || row.studentId }, row);
    await row.update(next);
    await this.replaceInstallments(row, next, payload);
    return this.getFee(id);
  }

  async deleteFee(id) {
    const row = await this.getFee(id);
    await FeeInstallment.destroy({ where: { studentFeeId: row.id } });
    await row.destroy();
    return { deleted: true, id };
  }

  async payInstallment(id, payload = {}, userId = null) {
    const row = await FeeInstallment.findByPk(id, { include: [{ model: StudentFee, as: 'fee' }] });
    if (!row) throw Object.assign(new Error('Installment not found'), { status: 404 });
    if (row.status === 'cancelled') throw Object.assign(new Error('Cannot pay a cancelled installment.'), { status: 400 });
    if (row.status === 'pending_confirmation') {
      throw Object.assign(new Error('This installment already has a payment waiting for confirmation.'), { status: 409 });
    }
    const remaining = roundMoney(amount(row.amount) - amount(row.paidAmount));
    const paying = roundMoney(payload.amount === undefined || payload.amount === null ? remaining : payload.amount);
    if (paying <= 0) throw Object.assign(new Error('Payment amount must be greater than 0.'), { status: 400 });
    if (paying > remaining) throw Object.assign(new Error('Payment exceeds installment remaining amount.'), { status: 400 });
    await row.update({
      pendingPaymentAmount: paying,
      status: 'pending_confirmation',
      paidDate: payload.paidDate || todayDate(),
      paymentMethod: payload.paymentMethod || row.paymentMethod || 'Cash',
      transactionReference: payload.transactionReference ?? row.transactionReference,
      notes: payload.notes ?? row.notes,
      accountingTransactionId: ['confirmed', 'reversed'].includes(row.status) && remaining > 0 ? null : row.accountingTransactionId,
      reversalAccountingTransactionId: row.status === 'reversed' && remaining > 0 ? null : row.reversalAccountingTransactionId,
      confirmedBy: null,
      confirmedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null
    });
    const fee = await this.getFee(row.studentFeeId);
    return { fee, payment: fee.installments.find((item) => String(item.id) === String(id)), recordedBy: userId, waitingForConfirmation: true };
  }

  accountingMethod(method) {
    const normalized = String(method || '').toLowerCase();
    if (normalized.includes('cash')) return 'cash';
    if (normalized.includes('bank') || normalized.includes('cheque')) return 'bank';
    if (normalized.includes('card')) return 'card';
    if (normalized.includes('online')) return 'online';
    return 'other';
  }

  async courseFeesCategory(transaction) {
    let category = await AccountingCategory.findOne({ where: { name: 'Course Fees', type: 'income' }, transaction });
    if (!category) {
      category = await AccountingCategory.create({
        name: 'Course Fees', type: 'income', description: 'Confirmed student fee payments', isActive: true
      }, { transaction }).catch(async () => AccountingCategory.findOne({ where: { name: 'Course Fees', type: 'income' }, transaction }));
    }
    return category;
  }

  async accountingPaymentContext(studentFeeId, transaction) {
    const fee = await StudentFee.findByPk(studentFeeId, { transaction });
    if (!fee) throw Object.assign(new Error('Fee record not found'), { status: 404 });
    const [student, course, batch, enrollment] = await Promise.all([
      Student.findByPk(fee.studentId, { transaction }),
      fee.courseId ? Course.findByPk(fee.courseId, { transaction }) : null,
      fee.batchId ? Batch.findByPk(fee.batchId, { transaction }) : null,
      fee.enrollmentId ? StudentEnrollment.findByPk(fee.enrollmentId, { transaction }) : null
    ]);
    if (!student) throw Object.assign(new Error('Student not found for fee payment'), { status: 404 });
    if (!registrationNumber(student)) await student.update({ studentNo: studentNo() }, { transaction });
    const regNo = registrationNumber(student);
    return {
      fee,
      student,
      course,
      batch,
      enrollment,
      description: `Student fee payment - ${student.name} - Reg No: ${regNo} - ${course?.name || 'Course'} - ${batch?.name || 'All batches'} - Enrollment: ${enrollment?.id || fee.enrollmentId || 'legacy'}`
    };
  }

  async confirmInstallmentPayment(id, userId) {
    let studentFeeId;
    let transactionId;
    let alreadyConfirmed = false;
    await sequelize.transaction(async (transaction) => {
      const row = await FeeInstallment.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!row) throw Object.assign(new Error('Installment not found'), { status: 404 });
      studentFeeId = row.studentFeeId;

      if (row.accountingTransactionId) {
        const context = await this.accountingPaymentContext(row.studentFeeId, transaction);
        const existingTransaction = await AccountingTransaction.findByPk(row.accountingTransactionId, { transaction });
        if (existingTransaction) {
          await existingTransaction.update({
            date: row.paidDate || existingTransaction.date,
            amount: amount(row.pendingPaymentAmount) > 0 ? row.pendingPaymentAmount : existingTransaction.amount,
            paymentMethod: this.accountingMethod(row.paymentMethod),
            referenceNo: row.transactionReference || existingTransaction.referenceNo || `FEE-INSTALLMENT-${row.id}`,
            description: context.description,
            relatedStudentId: context.student.id,
            relatedCourseId: context.course?.id || null,
            createdBy: existingTransaction.createdBy || userId || null
          }, { transaction });
          transactionId = existingTransaction.id;
        } else {
          const category = await this.courseFeesCategory(transaction);
          const replacement = await AccountingTransaction.create({
            type: 'income',
            date: row.paidDate || todayDate(),
            amount: row.pendingPaymentAmount || row.paidAmount,
            categoryId: category.id,
            paymentMethod: this.accountingMethod(row.paymentMethod),
            referenceNo: row.transactionReference || `FEE-INSTALLMENT-${row.id}`,
            description: context.description,
            relatedStudentId: context.student.id,
            relatedCourseId: context.course?.id || null,
            createdBy: userId || null
          }, { transaction });
          transactionId = replacement.id;
          await row.update({ accountingTransactionId: replacement.id }, { transaction });
        }
        alreadyConfirmed = row.status === 'confirmed';
        if (row.status !== 'confirmed') await row.update({ status: 'confirmed' }, { transaction });
        return;
      }
      if (row.status !== 'pending_confirmation') {
        throw Object.assign(new Error(`Only pending payments can be confirmed (current status: ${row.status}).`), { status: 409 });
      }

      const paymentAmount = roundMoney(row.pendingPaymentAmount);
      if (paymentAmount <= 0) throw Object.assign(new Error('Pending payment amount is invalid.'), { status: 422 });
      const context = await this.accountingPaymentContext(row.studentFeeId, transaction);
      const category = await this.courseFeesCategory(transaction);
      const accountingTransaction = await AccountingTransaction.create({
        type: 'income',
        date: row.paidDate || todayDate(),
        amount: paymentAmount,
        categoryId: category.id,
        paymentMethod: this.accountingMethod(row.paymentMethod),
        referenceNo: row.transactionReference || `FEE-INSTALLMENT-${row.id}`,
        description: context.description,
        relatedStudentId: context.student.id,
        relatedCourseId: context.course?.id || null,
        createdBy: userId || null
      }, { transaction });
      transactionId = accountingTransaction.id;
      await row.update({
        paidAmount: roundMoney(amount(row.paidAmount) + paymentAmount),
        pendingPaymentAmount: null,
        status: 'confirmed',
        confirmedBy: userId || null,
        confirmedAt: new Date(),
        accountingTransactionId: accountingTransaction.id,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null
      }, { transaction });

      const fee = await StudentFee.findByPk(row.studentFeeId, { transaction, lock: transaction.LOCK.UPDATE });
      const paidAmount = roundMoney(await FeeInstallment.sum('paidAmount', {
        where: { studentFeeId: row.studentFeeId },
        transaction
      }));
      const balance = roundMoney(Math.max(amount(fee.totalAmount) - paidAmount, 0));
      await fee.update({ paidAmount, balance, status: feeStatus(fee.totalAmount, paidAmount, fee.paymentType) }, { transaction });
    });

    const notification = alreadyConfirmed
      ? { status: 'skipped', reason: 'already_confirmed' }
      : await this.sendPaymentSuccessMessage(id, userId).catch((error) => {
          logger.warn('payment_success_notification_failed', { installmentId: id, error: error.message });
          return { status: 'failed', warning: error.message };
        });
    return {
      fee: await this.getFee(studentFeeId),
      accountingTransactionId: transactionId,
      notification,
      message: 'Payment confirmed and income recorded.'
    };
  }

  async rejectInstallmentPayment(id, payload = {}, userId) {
    const row = await FeeInstallment.findByPk(id);
    if (!row) throw Object.assign(new Error('Installment not found'), { status: 404 });
    if (row.accountingTransactionId || row.status === 'confirmed') {
      throw Object.assign(new Error('A confirmed payment cannot be rejected. Reverse it through Accounting instead.'), { status: 409 });
    }
    if (row.status !== 'pending_confirmation') {
      throw Object.assign(new Error('Only a payment waiting for confirmation can be rejected.'), { status: 409 });
    }
    await row.update({
      pendingPaymentAmount: null,
      status: 'rejected',
      rejectedBy: userId || null,
      rejectedAt: new Date(),
      rejectionReason: cleanText(payload.reason)
    });
    return { fee: await this.getFee(row.studentFeeId), payment: row, message: 'Payment rejected. No income was recorded.' };
  }

  async reverseInstallmentPayment(id, payload = {}, userId) {
    let studentFeeId;
    let reversalTransactionId;
    await sequelize.transaction(async (transaction) => {
      const row = await FeeInstallment.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!row) throw Object.assign(new Error('Installment not found'), { status: 404 });
      studentFeeId = row.studentFeeId;
      if (row.reversalAccountingTransactionId) {
        reversalTransactionId = row.reversalAccountingTransactionId;
        return;
      }
      if (row.status !== 'confirmed' || !row.accountingTransactionId) {
        throw Object.assign(new Error('Only a confirmed payment with recorded income can be reversed.'), { status: 409 });
      }
      const [originalTransaction, feeRecord] = await Promise.all([
        AccountingTransaction.findByPk(row.accountingTransactionId, { transaction }),
        StudentFee.findByPk(row.studentFeeId, { transaction })
      ]);
      if (!originalTransaction) throw Object.assign(new Error('The original accounting income transaction was not found.'), { status: 409 });

      let category = await AccountingCategory.findOne({ where: { name: 'Other Expenses', type: 'expense' }, transaction });
      if (!category) {
        category = await AccountingCategory.create({
          name: 'Other Expenses', type: 'expense', description: 'Accounting reversals and other expenses', isActive: true
        }, { transaction }).catch(async () => AccountingCategory.findOne({ where: { name: 'Other Expenses', type: 'expense' }, transaction }));
      }
      const reversal = await AccountingTransaction.create({
        type: 'expense',
        date: todayDate(),
        amount: originalTransaction.amount,
        categoryId: category.id,
        paymentMethod: originalTransaction.paymentMethod,
        referenceNo: `REV-${originalTransaction.id}`,
        description: cleanText(payload.reason) || `Reversal of fee income transaction ${originalTransaction.id}`,
        relatedStudentId: feeRecord?.studentId || null,
        relatedCourseId: feeRecord?.courseId || null,
        createdBy: userId || null
      }, { transaction });
      reversalTransactionId = reversal.id;
      await row.update({
        paidAmount: roundMoney(Math.max(amount(row.paidAmount) - amount(originalTransaction.amount), 0)),
        status: 'reversed',
        reversalAccountingTransactionId: reversal.id,
        notes: cleanText(payload.reason) || row.notes
      }, { transaction });

      const fee = await StudentFee.findByPk(row.studentFeeId, { transaction, lock: transaction.LOCK.UPDATE });
      const paidAmount = roundMoney(await FeeInstallment.sum('paidAmount', {
        where: { studentFeeId: row.studentFeeId },
        transaction
      }));
      const balance = roundMoney(Math.max(amount(fee.totalAmount) - paidAmount, 0));
      await fee.update({ paidAmount, balance, status: feeStatus(fee.totalAmount, paidAmount, fee.paymentType) }, { transaction });
    });
    return {
      fee: await this.getFee(studentFeeId),
      reversalAccountingTransactionId: reversalTransactionId,
      message: 'Payment reversed and a compensating accounting transaction was recorded.'
    };
  }

  async sendPaymentSuccessMessage(installmentId, userId) {
    const installment = await FeeInstallment.findByPk(installmentId, {
      include: [
        {
          model: StudentFee,
          as: 'fee',
          include: [
            { model: Student, as: 'student', include: [{ model: Contact, as: 'contact' }] },
            { model: Course, as: 'course' },
            { model: Batch, as: 'batch' }
          ]
        },
        { model: AccountingTransaction, as: 'accountingTransaction', required: false }
      ]
    });
    const student = installment?.fee?.student;
    if (!student) throw new Error('Student was not found for payment notification.');
    return studentMessageAutomationService.dispatch('payment_confirmation', student.id, {
      eventId: `installment:${installment.id}:confirmed`,
      eventDate: installment.paidDate || todayDate(),
      paymentAmount: installment.accountingTransaction?.amount || installment.paidAmount,
      paymentDate: installment.paidDate || new Date(),
      paymentMethod: installment.paymentMethod,
      installmentNo: installment.installmentNo,
      installmentDueDate: installment.dueDate,
      createdBy: userId
    });
  }

  async markOverdue(fees) {
    const now = todayDate();
    const feeRows = Array.isArray(fees) ? fees : [fees];
    for (const fee of feeRows) {
      for (const item of fee.installments || []) {
        if (!['paid', 'confirmed', 'pending_confirmation', 'rejected', 'cancelled', 'reversed'].includes(item.status) && item.dueDate < now) await item.update({ status: 'overdue' });
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
    const enrollment = payload.enrollmentId
      ? (student.enrollments || []).find((item) => String(item.id) === String(payload.enrollmentId))
      : (student.enrollments || []).find((item) => (
        item.enrollmentStatus === 'active'
        && String(item.courseId) === String(payload.courseId || student.courseId)
        && String(item.batchId || '') === String(payload.batchId || student.batchId || '')
      ));
    return AttendanceRecord.create({
      studentId: payload.studentId,
      enrollmentId: enrollment?.id || null,
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
    const enrollment = payload.enrollmentId
      ? (student.enrollments || []).find((item) => String(item.id) === String(payload.enrollmentId))
      : (student.enrollments || []).find((item) => (
        item.enrollmentStatus === 'completed'
        && String(item.courseId) === String(payload.courseId || student.courseId)
        && String(item.batchId || '') === String(payload.batchId || student.batchId || '')
      ));
    if (!enrollment || enrollment.enrollmentStatus !== 'completed') {
      throw Object.assign(new Error('A completed enrollment is required to issue a certificate'), { status: 400 });
    }
    const existing = await Certificate.findOne({ where: { studentId: student.id, enrollmentId: enrollment.id } });
    if (existing) throw Object.assign(new Error('A certificate already exists for this enrollment'), { status: 409 });
    const certificate = await Certificate.create({
      certificateNo: payload.certificateNo || certificateNo(),
      studentId: payload.studentId,
      enrollmentId: enrollment.id,
      courseId: enrollment.courseId,
      batchId: enrollment.batchId,
      issuedAt: payload.issuedAt || null,
      status: payload.status || 'draft',
      certificateUrl: payload.certificateUrl || null,
      notes: payload.notes || null,
      issuedBy: userId || null
    });
    if (certificate.status === 'issued') {
      await studentMessageAutomationService.dispatch('certificate_issued', student.id, {
        eventId: `certificate:${certificate.id}:issued`, eventDate: certificate.issuedAt || todayDate(),
        certificateUrl: certificate.certificateUrl || '', createdBy: userId
      }).catch((error) => logger.warn('certificate_message_queue_failed', { certificateId: certificate.id, error: error.message }));
    }
    return certificate;
  }

  async updateCertificate(id, payload) {
    const row = await Certificate.findByPk(id);
    if (!row) throw Object.assign(new Error('Certificate not found'), { status: 404 });
    const wasIssued = row.status === 'issued';
    await row.update(payload);
    if (!wasIssued && row.status === 'issued') {
      await studentMessageAutomationService.dispatch('certificate_issued', row.studentId, {
        eventId: `certificate:${row.id}:issued`, eventDate: row.issuedAt || todayDate(),
        certificateUrl: row.certificateUrl || ''
      }).catch((error) => logger.warn('certificate_message_queue_failed', { certificateId: row.id, error: error.message }));
    }
    return row;
  }

  async deleteCertificate(id) {
    const row = await Certificate.findByPk(id);
    if (!row) throw Object.assign(new Error('Certificate not found'), { status: 404 });
    await row.destroy();
    return { deleted: true, id };
  }

  async listStudentNotes(studentId) {
    await this.getStudent(studentId);
    return StudentNote.findAll({
      where: { studentId },
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      order: [['created_at', 'DESC']]
    });
  }

  async createStudentNote(studentId, payload, userId) {
    await this.getStudent(studentId);
    const note = String(payload.note || '').trim();
    if (!note) throw Object.assign(new Error('Note is required'), { status: 400 });
    return StudentNote.create({ studentId, note, createdBy: userId || null });
  }

  async deleteStudentNote(id) {
    const row = await StudentNote.findByPk(id);
    if (!row) throw Object.assign(new Error('Student note not found'), { status: 404 });
    await row.destroy();
    return { deleted: true, id };
  }

  async listStudentDocuments(studentId) {
    await this.getStudent(studentId);
    return StudentDocument.findAll({
      where: { studentId },
      include: [{ model: User, as: 'uploader', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      order: [['created_at', 'DESC']]
    });
  }

  async createStudentDocument(studentId, payload, userId) {
    await this.getStudent(studentId);
    const fileName = String(payload.fileName || '').trim();
    const fileUrl = String(payload.fileUrl || '').trim();
    if (!fileName || !fileUrl) throw Object.assign(new Error('File name and file URL are required'), { status: 400 });
    return StudentDocument.create({
      studentId,
      fileName,
      fileUrl,
      type: String(payload.type || '').trim() || null,
      uploadedBy: userId || null
    });
  }

  async deleteStudentDocument(id) {
    const row = await StudentDocument.findByPk(id);
    if (!row) throw Object.assign(new Error('Student document not found'), { status: 404 });
    await row.destroy();
    return { deleted: true, id };
  }

  async listStudentGuardians(studentId) {
    await this.getStudent(studentId);
    return StudentGuardian.findAll({
      where: { studentId },
      order: [['is_primary', 'DESC'], ['created_at', 'ASC']]
    });
  }

  async createStudentGuardian(studentId, payload) {
    await this.getStudent(studentId);
    const name = String(payload.name || '').trim();
    const relationship = String(payload.relationship || '').trim();
    if (!name || !relationship) throw Object.assign(new Error('Guardian name and relationship are required'), { status: 400 });
    if (payload.isPrimary === true) {
      await StudentGuardian.update({ isPrimary: false }, { where: { studentId } });
    }
    return StudentGuardian.create({
      studentId,
      name,
      relationship,
      phone: cleanText(payload.phone),
      whatsapp: cleanText(payload.whatsapp),
      email: cleanText(payload.email),
      dateOfBirth: payload.dateOfBirth || null,
      isPrimary: payload.isPrimary === true,
      isEmergencyContact: payload.isEmergencyContact === true,
      address: cleanText(payload.address),
      notes: cleanText(payload.notes)
    });
  }

  async updateStudentGuardian(guardianId, payload) {
    const guardian = await StudentGuardian.findByPk(guardianId);
    if (!guardian) throw Object.assign(new Error('Student guardian not found'), { status: 404 });
    const changes = {};
    ['name', 'relationship', 'phone', 'whatsapp', 'email', 'dateOfBirth', 'address', 'notes'].forEach((field) => {
      if (payload[field] !== undefined) changes[field] = ['name', 'relationship'].includes(field)
        ? String(payload[field] || '').trim()
        : field === 'dateOfBirth'
          ? payload[field] || null
          : cleanText(payload[field]);
    });
    if (changes.name === '' || changes.relationship === '') {
      throw Object.assign(new Error('Guardian name and relationship are required'), { status: 400 });
    }
    if (payload.isPrimary !== undefined) {
      changes.isPrimary = payload.isPrimary === true;
      if (changes.isPrimary) {
        await StudentGuardian.update({ isPrimary: false }, { where: { studentId: guardian.studentId } });
      }
    }
    if (payload.isEmergencyContact !== undefined) changes.isEmergencyContact = payload.isEmergencyContact === true;
    await guardian.update(changes);
    return guardian;
  }

  async deleteStudentGuardian(guardianId) {
    const guardian = await StudentGuardian.findByPk(guardianId);
    if (!guardian) throw Object.assign(new Error('Student guardian not found'), { status: 404 });
    await guardian.destroy();
    return { deleted: true, id: guardianId };
  }
}

module.exports = new EducationService();
