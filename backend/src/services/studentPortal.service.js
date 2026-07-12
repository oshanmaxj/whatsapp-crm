const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const {
  AttendanceRecord, Batch, Course, FeeInstallment, LmsLesson, LmsLessonMaterial, LmsLiveClassJoin,
  LmsLessonComment, LmsStudentProgress, Student, StudentEnrollment, StudentFee, StudentPortalSession, User
} = require('../models');
const whatsappService = require('./whatsapp.service');
const {
  PAYMENT_BLOCKED_MESSAGE, checkEnrollmentAccess, evaluateFeeAccess
} = require('./enrollmentAccess.service');

const portalSecret = process.env.LMS_STUDENT_JWT_SECRET || 'student_portal_secret_change_me';
const accessWarning = PAYMENT_BLOCKED_MESSAGE;
const tokenHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const sessionExpiry = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const otpExpiry = () => new Date(Date.now() + 5 * 60 * 1000);

function portalError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status, exposeMessage: true });
}

function normalizeSriLankanPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^07\d{8}$/.test(digits)) return `94${digits.slice(1)}`;
  return /^947\d{8}$/.test(digits) ? digits : '';
}

const lessonInclude = (studentId) => [
  { model: Course, as: 'course', attributes: ['id', 'name', 'code'] },
  { model: Batch, as: 'batch', required: false, attributes: ['id', 'name', 'code'] },
  { model: User, as: 'lecturer', required: false, attributes: ['id', 'firstName', 'lastName'] },
  { model: LmsLessonMaterial, as: 'materials', required: false },
  {
    model: LmsLessonComment, as: 'comments', required: false,
    include: [{ model: Student, as: 'student', attributes: ['id', 'name'] }]
  },
  { model: LmsStudentProgress, as: 'progress', required: false, where: { studentId } }
];

function publicStudent(student) {
  const enrollments = (student.enrollments || []).map((enrollment) => ({
    id: enrollment.id,
    enrollmentStatus: enrollment.enrollmentStatus,
    enrolledAt: enrollment.enrolledAt,
    course: enrollment.course,
    batch: enrollment.batch
  }));
  return {
    id: student.id, studentNo: student.studentNo, name: student.name, phone: student.phone,
    email: student.email, status: student.status, course: student.course, batch: student.batch,
    enrollments,
    courses: enrollments.filter((item) => item.enrollmentStatus === 'active').map((item) => item.course).filter(Boolean),
    batches: enrollments.filter((item) => item.enrollmentStatus === 'active').map((item) => item.batch).filter(Boolean)
  };
}

function liveClassAccess(lesson, paymentAllowed = true) {
  if (!lesson.liveClassAt) return { classStatus: null, canJoin: false, reason: 'not_live_class' };
  const starts = new Date(lesson.liveClassAt).getTime();
  const opens = starts - Number(lesson.allowJoinBeforeMinutes ?? 30) * 60000;
  const configuredAfter = Number(lesson.allowJoinAfterMinutes);
  const closes = starts + (
    Number.isFinite(configuredAfter) && configuredAfter !== 180
      ? configuredAfter
      : Number(lesson.durationMinutes || 120) + 30
  ) * 60000;
  const now = Date.now();
  const classStatus = now < opens ? 'upcoming' : now <= closes ? 'live_now' : 'completed';
  if (!paymentAllowed) return { classStatus, canJoin: false, reason: 'payment_blocked', message: accessWarning };
  if (!lesson.zoomLink) return { classStatus, canJoin: false, reason: 'join_link_missing' };
  if (now < opens) return { classStatus, canJoin: false, reason: 'not_available_yet', message: 'This class is not available yet.' };
  if (now > closes) return { classStatus, canJoin: false, reason: 'class_ended', message: 'This class has ended.' };
  return { classStatus, canJoin: true, reason: 'allowed' };
}

function safeBunnyUrl(lesson) {
  const embedMatch = String(lesson.embedCode || '').match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  const candidate = lesson.bunnyEmbedUrl || embedMatch?.[1]
    || (lesson.bunnyVideoId ? `https://iframe.mediadelivery.net/embed/${lesson.bunnyVideoId}` : '');
  try {
    const url = new URL(candidate);
    return ['iframe.mediadelivery.net', 'video.bunnycdn.com'].includes(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function serializeLesson(row, detailed = false, paymentAllowed = true) {
  const lesson = row.toJSON();
  const progress = lesson.progress?.[0] || null;
  const liveAccess = liveClassAccess(lesson, paymentAllowed);
  const data = {
    id: lesson.id, title: lesson.title, description: lesson.description, lessonOrder: lesson.lessonOrder,
    liveClassAt: lesson.liveClassAt, classStatus: liveAccess.classStatus,
    canJoin: liveAccess.canJoin, joinStatus: liveAccess.reason, joinMessage: liveAccess.message || null,
    joinButtonLabel: lesson.joinButtonLabel || 'Join Live Class', hasLiveClass: Boolean(lesson.liveClassAt && lesson.zoomLink),
    recordingUrl: paymentAllowed ? lesson.recordingUrl : null,
    bunnyVideoId: paymentAllowed ? lesson.bunnyVideoId : null,
    bunnyEmbedUrl: paymentAllowed ? safeBunnyUrl(lesson) : null,
    hasRecording: paymentAllowed && Boolean(lesson.recordingUrl || safeBunnyUrl(lesson)),
    durationMinutes: lesson.durationMinutes, course: lesson.course, batch: lesson.batch, lecturer: lesson.lecturer,
    scheduledStartAt: lesson.scheduledStartAt, scheduledEndAt: lesson.scheduledEndAt,
    source: lesson.source,
    accessStatus: paymentAllowed ? 'available' : 'payment_blocked', accessWarning: paymentAllowed ? null : accessWarning,
    createdAt: lesson.createdAt,
    progress: progress || { watchedPercentage: 0, lastWatchedSeconds: 0, isCompleted: false }
  };
  if (detailed) {
    data.materials = paymentAllowed ? (lesson.materials || []).filter((item) => item.status === 'published') : [];
    data.comments = lesson.comments || [];
  }
  return data;
}

class StudentPortalService {
  async findStudent(identifier) {
    const value = String(identifier || '').trim();
    if (!value) throw Object.assign(new Error('Phone number, registration number, or email is required'), { status: 400 });
    const student = await Student.scope('withPortalPassword').findOne({
      where: { [Op.or]: [{ studentNo: value }, { phone: value }, { email: { [Op.iLike]: value } }] },
      include: [
        { model: Course, as: 'course', required: false },
        { model: Batch, as: 'batch', required: false },
        {
          model: StudentEnrollment, as: 'enrollments', required: false,
          include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }]
        }
      ]
    });
    if (!student || !['enrolled', 'active'].includes(student.status)) {
      throw Object.assign(new Error('Invalid student login details'), { status: 401 });
    }
    return student;
  }

  async findStudentForOtp(identifier) {
    const value = String(identifier || '').trim();
    const phone = normalizeSriLankanPhone(value);
    if (!phone && /^\+?\d[\d\s()-]*$/.test(value)) throw portalError('INVALID_PHONE', 'Enter a valid Sri Lankan mobile number.', 422);
    const candidates = phone
      ? [phone, `+${phone}`, `0${phone.slice(2)}`]
      : [];
    const student = await Student.scope('withPortalPassword').findOne({
      where: { [Op.or]: [
        { studentNo: value }, { email: { [Op.iLike]: value } },
        ...(candidates.length ? [{ phone: { [Op.in]: candidates } }] : [])
      ] },
      include: [
        { model: Course, as: 'course', required: false }, { model: Batch, as: 'batch', required: false },
        { model: StudentEnrollment, as: 'enrollments', required: false, include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }] }
      ]
    });
    if (!student || !['enrolled', 'active'].includes(student.status)) throw portalError('STUDENT_NOT_FOUND', 'Unable to send a code. Check your details or contact the office.', 401);
    return student;
  }

  feeAccess(fee, installments = []) {
    const access = evaluateFeeAccess(fee, installments);
    return {
      ...access,
      allowed: access.accessAllowed
    };
  }

  async paymentAccess(studentOrId) {
    const student = typeof studentOrId === 'object' ? studentOrId : await Student.findByPk(studentOrId);
    if (!student) return { allowed: false, allAllowed: false, warning: accessWarning, reason: 'student_not_found', fees: [], enrollments: [] };
    const enrollments = await StudentEnrollment.findAll({
      where: { studentId: student.id, enrollmentStatus: 'active' },
      include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }],
      order: [['enrolled_at', 'ASC']]
    });
    const fees = await StudentFee.findAll({
      where: { studentId: student.id, status: { [Op.ne]: 'cancelled' } },
      include: [{ model: FeeInstallment, as: 'installments', required: false }],
      order: [['created_at', 'DESC']]
    });
    const enrollmentAccess = enrollments.map((enrollment) => {
      const candidates = fees.filter((fee) => (
        String(fee.enrollmentId || '') === String(enrollment.id)
        || (!fee.enrollmentId && String(fee.courseId) === String(enrollment.courseId)
        && (
          enrollment.batchId
            ? String(fee.batchId || '') === String(enrollment.batchId)
            : !fee.batchId
        ))
      ));
      const fee = candidates[0] || null;
      return {
        enrollmentId: enrollment.id,
        courseId: enrollment.courseId,
        batchId: enrollment.batchId,
        course: enrollment.course,
        batch: enrollment.batch,
        ...this.feeAccess(fee, fee?.installments || []),
        fee: fee ? {
          id: fee.id, paymentType: fee.paymentType, totalAmount: fee.totalAmount, paidAmount: fee.paidAmount,
          balance: fee.balance, status: fee.status, dueDate: fee.dueDate, installments: fee.installments || []
        } : null
      };
    });
    const allowed = enrollmentAccess.some((item) => item.allowed);
    const allAllowed = enrollmentAccess.length > 0 && enrollmentAccess.every((item) => item.allowed);
    return {
      allowed,
      allAllowed,
      warning: allAllowed ? null : allowed ? 'Some course access is restricted due to pending payment.' : accessWarning,
      reason: allAllowed ? 'all_enrollments_allowed' : allowed ? 'partial_enrollment_access' : 'no_enrollment_access',
      enrollments: enrollmentAccess,
      fees: fees.map((fee) => ({
        id: fee.id, enrollmentId: fee.enrollmentId, courseId: fee.courseId, batchId: fee.batchId,
        paymentType: fee.paymentType, totalAmount: fee.totalAmount, paidAmount: fee.paidAmount,
        balance: fee.balance, status: fee.status, dueDate: fee.dueDate, installments: fee.installments || []
      }))
    };
  }

  async issueToken(student, session = null) {
    const jti = crypto.randomBytes(24).toString('hex');
    const expiresAt = sessionExpiry();
    const row = session || await StudentPortalSession.create({ studentId: student.id, tokenHash: tokenHash(jti), expiresAt, verifiedAt: new Date() });
    if (session) await session.update({ tokenHash: tokenHash(jti), otpHash: null, otpExpiresAt: null, verifiedAt: new Date(), expiresAt });
    const token = jwt.sign({ type: 'student_portal', studentId: student.id, sessionId: row.id, jti }, portalSecret, { expiresIn: '7d' });
    return { token, expiresAt };
  }

  async login({ identifier, password, method }) {
    const student = method === 'otp' && !password ? await this.findStudentForOtp(identifier) : await this.findStudent(identifier);
    if (password || method === 'password') {
      if (!password || !await student.verifyPortalPassword(password)) {
        throw Object.assign(new Error('Invalid student login details'), { status: 401 });
      }
      return { ...(await this.issueToken(student)), student: publicStudent(student), paymentAccess: await this.paymentAccess(student) };
    }

    const phone = normalizeSriLankanPhone(student.phone);
    if (!phone) throw portalError('INVALID_PHONE', 'A valid WhatsApp number is not registered for this account.', 422);
    const now = new Date();
    const minIntervalSeconds = Math.max(60, Number(process.env.STUDENT_OTP_MIN_INTERVAL_SECONDS || 60));
    const maxPerHour = Math.max(1, Number(process.env.STUDENT_OTP_MAX_REQUESTS_PER_HOUR || 5));
    const recent = await StudentPortalSession.findAll({
      where: { studentId: student.id, createdAt: { [Op.gte]: new Date(now.getTime() - 60 * 60 * 1000) }, otpHash: { [Op.ne]: null } },
      order: [['created_at', 'DESC']], attributes: ['id', 'createdAt']
    });
    if (recent.length >= maxPerHour || (recent[0] && now - new Date(recent[0].createdAt) < minIntervalSeconds * 1000)) {
      logger.warn('student_otp_send_failed', { studentId: student.id, phone, errorCode: 'OTP_RATE_LIMITED' });
      throw portalError('OTP_RATE_LIMITED', 'Please wait before requesting another code.', 429);
    }
    await StudentPortalSession.update({ revokedAt: now }, { where: { studentId: student.id, otpHash: { [Op.ne]: null }, revokedAt: null, verifiedAt: null } });
    logger.info('student_otp_requested', { studentId: student.id, phone });
    const otp = String(crypto.randomInt(100000, 1000000));
    const challenge = crypto.randomBytes(24).toString('hex');
    const session = await StudentPortalSession.create({
      studentId: student.id,
      tokenHash: tokenHash(challenge),
      otpHash: await bcrypt.hash(otp, 10),
      otpExpiresAt: otpExpiry(), expiresAt: otpExpiry()
    });
    const templateName = String(process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
    const language = String(process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || 'en_US').trim();
    if (!templateName) { await session.update({ revokedAt: new Date() }); throw portalError('OTP_SEND_FAILED', 'WhatsApp OTP is not configured.', 503); }
    try {
      const components = [{ type: 'body', parameters: [{ type: 'text', text: otp }] }];
      if (process.env.WHATSAPP_OTP_COPY_CODE_BUTTON !== 'false') components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] });
      logger.info('student_otp_send_attempt', { studentId: student.id, phone, templateName, language });
      await whatsappService.sendTemplateMessage({ to: phone, templateName, language, components, log: false });
      logger.info('student_otp_sent', { studentId: student.id, phone, templateName });
    } catch (error) {
      const meta = error.response?.data?.error || error.metaError?.error || error.metaError || {};
      logger.warn('student_otp_send_failed', { studentId: student.id, phone, errorCode: meta.code || 'OTP_SEND_FAILED', errorMessage: meta.message || error.message });
      await session.update({ revokedAt: new Date() });
      throw portalError('OTP_SEND_FAILED', 'Unable to deliver the WhatsApp code. Please try again later.', 503);
    }
    return {
      challengeToken: challenge,
      expiresAt: session.otpExpiresAt,
      resendAfterSeconds: minIntervalSeconds,
      delivery: 'whatsapp'
    };
  }

  async verifyOtp({ challengeToken, otp }) {
    const session = await StudentPortalSession.findOne({ where: { tokenHash: tokenHash(challengeToken || ''), revokedAt: null } });
    if (!session || !session.otpHash || session.otpUsedAt) throw portalError('OTP_INVALID', 'The code is invalid or has already been used.', 401);
    if (new Date(session.otpExpiresAt) <= new Date()) { logger.warn('student_otp_verification_failed', { studentId: session.studentId, errorCode: 'OTP_EXPIRED' }); throw portalError('OTP_EXPIRED', 'The code has expired. Request a new one.', 401); }
    const valid = /^\d{6}$/.test(String(otp || '')) && await bcrypt.compare(String(otp), session.otpHash);
    if (!valid) { await session.increment('otpAttempts'); logger.warn('student_otp_verification_failed', { studentId: session.studentId, errorCode: 'OTP_INVALID' }); throw portalError('OTP_INVALID', 'The code is incorrect.', 401); }
    const [claimed] = await StudentPortalSession.update({ otpUsedAt: new Date() }, { where: { id: session.id, otpUsedAt: null, revokedAt: null } });
    if (claimed !== 1) throw portalError('OTP_INVALID', 'The code is invalid or has already been used.', 401);
    logger.info('student_otp_verified', { studentId: session.studentId });
    const student = await this.findStudent((await Student.findByPk(session.studentId)).studentNo);
    return { ...(await this.issueToken(student, session)), student: publicStudent(student), paymentAccess: await this.paymentAccess(student) };
  }

  async authenticate(token) {
    const payload = jwt.verify(token, portalSecret);
    if (payload.type !== 'student_portal') throw new Error('Invalid student portal token');
    const session = await StudentPortalSession.findOne({ where: { id: payload.sessionId, studentId: payload.studentId, tokenHash: tokenHash(payload.jti), revokedAt: null } });
    if (!session || new Date(session.expiresAt) <= new Date()) throw new Error('Student portal session expired');
    const student = await Student.findByPk(payload.studentId, {
      include: [
        { model: Course, as: 'course', required: false },
        { model: Batch, as: 'batch', required: false },
        {
          model: StudentEnrollment, as: 'enrollments', required: false,
          include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }]
        }
      ]
    });
    if (!student || !['enrolled', 'active'].includes(student.status)) throw new Error('Student account is not active');
    return { student, paymentAccess: await this.paymentAccess(student) };
  }

  lessonWhere(enrollments) {
    const enrollmentPairs = enrollments.map((enrollment) => ({
      courseId: enrollment.courseId,
      [Op.or]: enrollment.batchId ? [{ batchId: null }, { batchId: enrollment.batchId }] : [{ batchId: null }]
    }));
    return {
      isPublished: true,
      [Op.and]: [
        { [Op.or]: enrollmentPairs.length ? enrollmentPairs : [{ id: null }] },
        { [Op.or]: [{ releaseAt: null }, { releaseAt: { [Op.lte]: new Date() } }] }
      ]
    };
  }

  async activeEnrollments(student) {
    return StudentEnrollment.findAll({
      where: { studentId: student.id, enrollmentStatus: 'active' },
      include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }]
    });
  }

  matchingAccess(lesson, paymentAccess) {
    const matches = (paymentAccess.enrollments || []).filter((item) => (
      String(item.courseId) === String(lesson.courseId)
      && (!lesson.batchId || String(item.batchId || '') === String(lesson.batchId))
    ));
    return matches.find((item) => item.allowed) || matches[0] || null;
  }

  async lessons(student, paymentAccess = null) {
    const access = paymentAccess || await this.paymentAccess(student);
    const enrollments = await this.activeEnrollments(student);
    const rows = await LmsLesson.findAll({ where: this.lessonWhere(enrollments), include: lessonInclude(student.id), order: [['lesson_order', 'ASC'], ['created_at', 'ASC']] });
    return rows.map((row) => {
      const enrollmentAccess = this.matchingAccess(row, access);
      return { ...serializeLesson(row, false, Boolean(enrollmentAccess?.allowed)), enrollmentAccess };
    });
  }

  async lesson(student, id, paymentAccess = null) {
    const access = paymentAccess || await this.paymentAccess(student);
    const enrollments = await this.activeEnrollments(student);
    const row = await LmsLesson.findOne({ where: { ...this.lessonWhere(enrollments), id }, include: lessonInclude(student.id) });
    if (!row) throw Object.assign(new Error('Lesson is unavailable for this enrollment'), { status: 404 });
    const enrollmentAccess = this.matchingAccess(row, access);
    await LmsStudentProgress.findOrCreate({ where: { studentId: student.id, lessonId: row.id }, defaults: { openedAt: new Date() } });
    return {
      ...serializeLesson(await LmsLesson.findByPk(row.id, { include: lessonInclude(student.id) }), true, Boolean(enrollmentAccess?.allowed)),
      enrollmentAccess
    };
  }

  async updateProgress(student, lessonId, payload) {
    const lesson = await this.lesson(student, lessonId);
    if (lesson.accessStatus === 'payment_blocked') throw Object.assign(new Error(accessWarning), { status: 403 });
    const [row] = await LmsStudentProgress.findOrCreate({ where: { studentId: student.id, lessonId }, defaults: { openedAt: new Date() } });
    const percentage = Math.max(Number(row.watchedPercentage || 0), Math.min(100, Math.max(0, Number(payload.watchedPercentage || 0))));
    const complete = Boolean(payload.isCompleted) || percentage >= 90;
    await row.update({
      openedAt: row.openedAt || new Date(),
      lastWatchedSeconds: Math.max(Number(row.lastWatchedSeconds || 0), Number(payload.lastWatchedSeconds || 0)),
      watchedPercentage: percentage,
      isCompleted: complete,
      completedAt: complete ? row.completedAt || new Date() : null
    });
    return row;
  }

  async materials(student, paymentAccess = null) {
    const access = paymentAccess || await this.paymentAccess(student);
    const enrollments = await this.activeEnrollments(student);
    const rows = await LmsLesson.findAll({
      where: this.lessonWhere(enrollments),
      include: lessonInclude(student.id),
      order: [['lesson_order', 'ASC']]
    });
    return rows.flatMap((row) => {
      const enrollmentAccess = this.matchingAccess(row, access);
      if (!enrollmentAccess?.allowed) return [];
      return (row.materials || []).filter((material) => material.status === 'published').map((material) => ({
        ...material.toJSON(),
        lesson: { id: row.id, title: row.title },
        course: row.course,
        batch: row.batch
      }));
    });
  }

  async addComment(student, lessonId, payload) {
    const comment = String(payload.comment || '').trim();
    if (!comment) throw Object.assign(new Error('Comment is required'), { status: 400 });
    if (comment.length > 2000) throw Object.assign(new Error('Comment must be 2000 characters or fewer'), { status: 400 });
    const lesson = await this.lesson(student, lessonId);
    if (lesson.accessStatus !== 'available') throw Object.assign(new Error(accessWarning), { status: 403 });
    return LmsLessonComment.create({ lessonId, studentId: student.id, comment });
  }

  async joinLiveClass(student, lessonId, request = {}) {
    const payment = await this.paymentAccess(student);
    const enrollments = await this.activeEnrollments(student);
    const rawLesson = await LmsLesson.findOne({ where: { ...this.lessonWhere(enrollments), id: lessonId } });
    const enrollmentCheck = rawLesson
      ? await checkEnrollmentAccess(student.id, rawLesson.courseId, rawLesson.batchId)
      : null;
    const enrollmentAccess = enrollmentCheck?.hasEnrollment
      ? { ...enrollmentCheck, allowed: enrollmentCheck.accessAllowed, enrollmentId: enrollmentCheck.enrollment.id, batchId: enrollmentCheck.enrollment.batchId }
      : null;
    let access = rawLesson ? liveClassAccess(rawLesson.toJSON(), Boolean(enrollmentAccess?.allowed)) : { canJoin: false, reason: 'lesson_unavailable' };
    if (!rawLesson) access = { canJoin: false, reason: 'lesson_unavailable', message: 'Lesson is unavailable for this enrollment.' };
    await LmsLiveClassJoin.create({
      studentId: student.id, lessonId,
      joinedAt: access.canJoin ? new Date() : null,
      ipAddress: request.ipAddress || null, userAgent: request.userAgent || null,
      accessStatus: access.canJoin ? 'allowed' : 'blocked', blockedReason: access.canJoin ? null : access.reason
    });
    if (!access.canJoin) {
      const status = access.reason === 'lesson_unavailable' ? 404 : access.reason === 'payment_blocked' ? 403 : 400;
      throw Object.assign(new Error(access.message || 'This live class is not available to join.'), { status });
    }
    const attendanceDate = new Date(rawLesson.liveClassAt).toISOString().slice(0, 10);
    const [attendance, created] = await AttendanceRecord.findOrCreate({
      where: { studentId: student.id, lessonId: rawLesson.id },
      defaults: {
        enrollmentId: enrollmentAccess.enrollmentId,
        courseId: rawLesson.courseId, batchId: rawLesson.batchId || enrollmentAccess?.batchId || null, attendanceDate,
        status: 'present', source: 'lms_join', markedAt: new Date(), joinedAt: new Date(),
        notes: `Joined LMS class: ${rawLesson.title}`
      }
    });
    if (!created) await attendance.update({
      enrollmentId: enrollmentAccess.enrollmentId,
      status: 'present', source: 'lms_join', markedAt: attendance.markedAt || new Date(), joinedAt: new Date()
    });
    await LmsStudentProgress.findOrCreate({ where: { studentId: student.id, lessonId: rawLesson.id }, defaults: { openedAt: new Date() } });
    return { liveClassUrl: rawLesson.zoomLink, zoomLink: rawLesson.zoomLink, attendanceMarked: true };
  }

  async dashboard(student, paymentAccess) {
    const lessons = await this.lessons(student, paymentAccess);
    const now = Date.now();
    const nextLiveClass = lessons.filter((item) => item.hasLiveClass && new Date(item.liveClassAt).getTime() + 3 * 60 * 60 * 1000 >= now)
      .sort((a, b) => new Date(a.liveClassAt) - new Date(b.liveClassAt))[0] || null;
    const recordings = lessons.filter((item) => item.recordingUrl || item.bunnyEmbedUrl).slice(-4).reverse();
    const attendance = await AttendanceRecord.findAll({ where: { studentId: student.id } });
    const attended = attendance.filter((row) => ['present', 'late'].includes(row.status)).length;
    const completed = lessons.filter((item) => item.progress?.isCompleted).length;
    return {
      student: publicStudent(student), paymentAccess,
      nextLiveClass,
      recentLessons: lessons.slice(0, 6),
      latestRecordings: recordings,
      attendance: { total: attendance.length, attended, percentage: attendance.length ? Math.round(attended / attendance.length * 100) : 0 },
      progressPercentage: lessons.length ? Math.round(completed / lessons.length * 100) : 0,
      myCourses: (paymentAccess.enrollments || []).map((item) => ({
        enrollmentId: item.enrollmentId, course: item.course, batch: item.batch,
        enrollmentStatus: 'active', paymentStatus: item.paymentStatus,
        accessAllowed: item.allowed, accessReason: item.reason,
        viewLessonsUrl: `/student/lessons?enrollmentId=${item.enrollmentId}`,
        nextClass: lessons.find((lesson) => (
          String(lesson.course?.id) === String(item.courseId)
          && (!lesson.batch?.id || String(lesson.batch.id) === String(item.batchId || ''))
          && lesson.hasLiveClass
          && lesson.classStatus !== 'completed'
        )) || null
      })),
      myBatches: (paymentAccess.enrollments || []).filter((item) => item.batch).map((item) => item.batch),
      upcomingClasses: lessons.filter((item) => item.hasLiveClass && item.classStatus !== 'completed')
        .sort((a, b) => new Date(a.liveClassAt) - new Date(b.liveClassAt)),
      announcements: []
    };
  }

  async myCourses(student, paymentAccess) {
    return (await this.dashboard(student, paymentAccess)).myCourses;
  }

  async upcomingClasses(student, paymentAccess) {
    return (await this.dashboard(student, paymentAccess)).upcomingClasses;
  }
}

module.exports = new StudentPortalService();
