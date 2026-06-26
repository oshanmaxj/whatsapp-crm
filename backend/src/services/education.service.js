const { Op } = require('sequelize');
const {
  AttendanceRecord,
  Batch,
  Certificate,
  Contact,
  Conversation,
  Course,
  FeeInstallment,
  Lead,
  LeadStatus,
  Message,
  Student,
  StudentDocument,
  StudentFee,
  StudentGuardian,
  StudentNote,
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

  async getStudentProfile(id) {
    const student = await Student.findByPk(id, {
      include: [
        { model: Contact, as: 'contact', required: false },
        { model: Lead, as: 'lead', required: false },
        { model: Course, as: 'course', required: false },
        { model: Batch, as: 'batch', required: false, include: [{ model: User, as: 'trainer', attributes: ['id', 'firstName', 'lastName', 'email'] }] },
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
    };
  }

  async createStudent(payload) {
    const name = String(payload.name || '').trim();
    const phone = String(payload.phone || '').trim();
    const email = String(payload.email || '').trim() || null;

    if (!name || !phone) {
      throw Object.assign(new Error('Student name and phone are required'), { status: 400 });
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

    const student = await Student.create({
      studentNo: payload.studentNo || studentNo(),
      contactId,
      leadId: optionalId(payload.leadId),
      courseId: optionalId(payload.courseId),
      batchId: optionalId(payload.batchId),
      name,
      phone,
      email,
      dateOfBirth: payload.dateOfBirth || null,
      status: payload.status || 'enrolled',
      enrolledAt: payload.enrolledAt || new Date(),
      notes: payload.notes || null
    });
    return this.getStudent(student.id);
  }

  async updateStudent(id, payload) {
    const row = await this.getStudent(id);
    const next = { ...payload };
    if ('courseId' in next) next.courseId = optionalId(next.courseId);
    if ('batchId' in next) next.batchId = optionalId(next.batchId);
    if ('leadId' in next) next.leadId = optionalId(next.leadId);
    await row.update(next);
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

  async feePayload(payload, existing = null) {
    if (!payload.studentId && !existing?.studentId) throw Object.assign(new Error('Student is required'), { status: 400 });
    const student = await this.getStudent(payload.studentId || existing.studentId);
    const courseId = optionalId(payload.courseId) || student.courseId || existing?.courseId || null;
    const batchId = optionalId(payload.batchId) || student.batchId || existing?.batchId || null;
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
    const paidAmount = paymentType === 'free_card' ? 0 : Math.min(amount(payload.paidAmount ?? existing?.paidAmount), discount.totalAmount);
    const balance = roundMoney(Math.max(discount.totalAmount - paidAmount, 0));

    return {
      studentId: student.id,
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

  async createFee(payload) {
    const feeData = await this.feePayload(payload);
    const fee = await StudentFee.create(feeData);
    await this.replaceInstallments(fee, feeData, payload);
    return this.getFee(fee.id);
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

  async payInstallment(id, payload = {}) {
    const row = await FeeInstallment.findByPk(id, { include: [{ model: StudentFee, as: 'fee' }] });
    if (!row) throw Object.assign(new Error('Installment not found'), { status: 404 });
    if (row.status === 'cancelled') throw Object.assign(new Error('Cannot pay a cancelled installment.'), { status: 400 });
    const remaining = roundMoney(amount(row.amount) - amount(row.paidAmount));
    const paying = roundMoney(payload.amount === undefined || payload.amount === null ? remaining : payload.amount);
    if (paying <= 0) throw Object.assign(new Error('Payment amount must be greater than 0.'), { status: 400 });
    if (paying > remaining) throw Object.assign(new Error('Payment exceeds installment remaining amount.'), { status: 400 });
    const paidAmount = roundMoney(amount(row.paidAmount) + paying);
    const status = paidAmount >= amount(row.amount) ? 'paid' : 'partially_paid';
    await row.update({
      paidAmount,
      status,
      paidDate: payload.paidDate || todayDate(),
      paymentMethod: payload.paymentMethod || row.paymentMethod || 'Cash',
      transactionReference: payload.transactionReference ?? row.transactionReference,
      notes: payload.notes ?? row.notes
    });
    return this.recalculateFee(row.studentFeeId);
  }

  async markOverdue(fees) {
    const now = todayDate();
    const feeRows = Array.isArray(fees) ? fees : [fees];
    for (const fee of feeRows) {
      for (const item of fee.installments || []) {
        if (!['paid', 'cancelled'].includes(item.status) && item.dueDate < now) await item.update({ status: 'overdue' });
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
