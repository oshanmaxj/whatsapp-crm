const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  AppSetting, Batch, Course, Student, StudentAutomationDispatch, StudentEnrollment, StudentMessageTemplate
} = require('../models');
const messageQueueService = require('./messageQueue.service');

const SUPPORTED_VARIABLES = [
  'student_name', 'registration_number', 'course_name', 'batch_name', 'email', 'phone',
  'portal_password', 'portal_url', 'company_name', 'company_phone', 'zoom_join_url',
  'class_date', 'class_time', 'lesson_id', 'lesson_name', 'recording_url', 'payment_amount',
  'payment_date', 'payment_method', 'installment_no', 'installment_due_date', 'certificate_url'
  , 'portal_username', 'whatsapp_group_link', 'whatsapp_group_name', 'enrollment_id',
  'lesson_title', 'portal_lesson_link', 'recording_link'
];
const zoomUrlPattern = /(?:https?:\/\/)?(?:[\w-]+\.)?zoom\.(?:us|com)\//i;
const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-GB') : '';
const formatTime = (value) => value ? new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
const render = (text, variables) => String(text || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => variables[key] == null ? '' : String(variables[key]));

function secureWhatsappContent(template, body, buttons) {
  const combined = `${body}\n${JSON.stringify(buttons)}`;
  if (template.key === 'class_reminder' && (combined.includes('{{zoom_join_url}}') || zoomUrlPattern.test(combined))) {
    throw Object.assign(new Error('Class reminders may only link to the LMS; raw Zoom links are not allowed.'), { status: 400 });
  }
  if (zoomUrlPattern.test(combined)) {
    throw Object.assign(new Error('Raw Zoom links cannot be sent through student automation messages.'), { status: 400 });
  }
}

class StudentMessageAutomationService {
  variables() {
    return SUPPORTED_VARIABLES;
  }

  async list() {
    return StudentMessageTemplate.findAll({ order: [['category', 'ASC'], ['title', 'ASC']] });
  }

  async get(key) {
    const row = await StudentMessageTemplate.findOne({ where: { key } });
    if (!row) throw Object.assign(new Error('Message template not found'), { status: 404 });
    return row;
  }

  async update(id, payload) {
    const row = await StudentMessageTemplate.findByPk(id);
    if (!row) throw Object.assign(new Error('Message template not found'), { status: 404 });
    const values = {};
    ['title', 'category', 'body', 'buttons', 'isActive', 'automationEnabled'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(payload, key)) values[key] = payload[key];
    });
    if (values.body !== undefined && !String(values.body).trim()) throw Object.assign(new Error('Template body is required'), { status: 400 });
    secureWhatsappContent(row, values.body ?? row.body, values.buttons ?? row.buttons);
    await row.update(values);
    return row;
  }

  async companyVariables() {
    const profile = await AppSetting.findOne({ where: { namespace: 'company', key: 'profile' } });
    const value = profile?.value || {};
    return {
      company_name: value.name || process.env.COMPANY_NAME || 'Our Institute',
      company_phone: value.phone || process.env.COMPANY_PHONE || '',
      portal_url: process.env.STUDENT_PORTAL_URL || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/student`
    };
  }

  async context(studentId, input = {}) {
    const student = await Student.findByPk(studentId, {
      include: [
        { model: Course, as: 'course', required: false },
        { model: Batch, as: 'batch', required: false }
      ]
    });
    if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });
    const enrollment = input.enrollmentId ? await StudentEnrollment.findOne({
      where: { id: input.enrollmentId, studentId },
      include: [
        { model: Course, as: 'course', required: false },
        { model: Batch, as: 'batch', required: false }
      ]
    }) : null;
    const company = await this.companyVariables();
    const group = enrollment?.batch?.whatsappGroupLink
      ? enrollment.batch
      : enrollment?.course?.whatsappGroupLink ? enrollment.course : null;
    return {
      student,
      variables: {
        ...company,
        student_name: student.name,
        registration_number: student.studentNo,
        course_name: enrollment?.course?.name || student.course?.name || '',
        batch_name: enrollment?.batch?.name || student.batch?.name || '',
        email: student.email || '',
        phone: student.phone || '',
        portal_password: input.portalPassword || '',
        portal_username: student.studentNo || student.email || student.phone || '',
        whatsapp_group_link: group?.whatsappGroupLink || '',
        whatsapp_group_name: group?.whatsappGroupName || '',
        enrollment_id: enrollment?.id || '',
        class_date: formatDate(input.classDate || input.liveClassAt),
        class_time: formatTime(input.classTime || input.liveClassAt),
        lesson_id: input.lessonId || '',
        lesson_name: input.lessonName || '',
        lesson_title: input.lessonName || '',
        portal_lesson_link: input.lessonId ? `${company.portal_url}/lessons/${input.lessonId}` : company.portal_url,
        recording_url: input.recordingUrl || '',
        recording_link: input.recordingUrl || '',
        payment_amount: input.paymentAmount || '',
        payment_date: formatDate(input.paymentDate),
        payment_method: input.paymentMethod || '',
        installment_no: input.installmentNo || '',
        installment_due_date: formatDate(input.installmentDueDate),
        certificate_url: input.certificateUrl || '',
        zoom_join_url: '',
        ...input.variables
      }
    };
  }

  renderTemplate(template, variables) {
    const buttons = (Array.isArray(template.buttons) ? template.buttons : []).map((button) => ({
      ...button, title: render(button.title, variables), url: render(button.url, variables)
    }));
    const body = render(template.body, variables)
      .replace(/^\s*WhatsApp Group:\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    secureWhatsappContent(template, body, buttons);
    const linkText = buttons.filter((button) => button.url).map((button) => `${button.title}: ${button.url}`).join('\n');
    return { body, buttons, text: linkText ? `${body}\n\n${linkText}` : body };
  }

  async preview(key, variables = {}) {
    const template = await this.get(key);
    const company = await this.companyVariables();
    return { ...this.renderTemplate(template, { ...company, ...variables }), variables: SUPPORTED_VARIABLES };
  }

  async dispatch(templateKey, studentId, event = {}) {
    const template = await this.get(templateKey);
    if (!template.isActive || !template.automationEnabled) return { status: 'disabled', templateKey };
    const eventKey = String(event.eventId || event.eventKey || event.eventDate || new Date().toISOString().slice(0, 10));
    const dedupeKey = crypto.createHash('sha256').update(`${templateKey}:${studentId}:${eventKey}`).digest('hex');
    const existing = await StudentAutomationDispatch.findOne({ where: { dedupeKey } });
    if (existing) return { status: 'duplicate', dispatch: existing };
    const { student, variables } = await this.context(studentId, event);
    if (!student.phone) return { status: 'skipped', reason: 'student_phone_missing' };
    const rendered = this.renderTemplate(template, variables);
    const dispatch = await StudentAutomationDispatch.create({
      templateKey, studentId, eventKey, eventDate: event.eventDate || null, dedupeKey,
      status: 'queued', payload: { variables, text: rendered.text }
    });
    try {
      const queue = await messageQueueService.enqueue({
        channel: 'whatsapp',
        messageType: 'text',
        to: student.phone,
        scheduledAt: event.scheduledAt || new Date(),
        maxAttempts: 3,
        whatsappAccountId: event.whatsappAccountId || null,
        conversationId: event.conversationId || null,
        contactId: student.contactId || null,
        payload: {
          text: rendered.text,
          automationDispatchId: dispatch.id,
          automationTemplateKey: templateKey,
          studentId,
          contactId: student.contactId,
          leadId: student.leadId,
          studentName: student.name,
          conversationId: event.conversationId || null,
          whatsappAccountId: event.whatsappAccountId || null,
          sourceMessageId: event.sourceMessageId || null,
          paymentSlipId: event.paymentSlipId || null,
          paymentId: event.paymentId || null,
          buttons: rendered.buttons
        }
      }, event.createdBy || null);
      await dispatch.update({ queueId: queue.id });
      return { status: 'queued', dispatch, queue };
    } catch (error) {
      await dispatch.update({ status: 'failed' });
      throw error;
    }
  }

  async dispatchEnrollmentWelcome(enrollmentId, event = {}) {
    const enrollment = await StudentEnrollment.findByPk(enrollmentId);
    if (!enrollment) throw Object.assign(new Error('Student enrollment not found'), { status: 404 });
    return this.dispatch('enrollment_welcome', enrollment.studentId, {
      ...event,
      enrollmentId,
      eventId: event.eventId || `enrollment:${enrollmentId}`,
      eventDate: event.eventDate || new Date().toISOString().slice(0, 10)
    });
  }

  async sendTest(key, payload) {
    const template = await this.get(key);
    let variables = { ...(await this.companyVariables()), ...(payload.variables || {}) };
    let to = payload.phone;
    let student = null;
    if (payload.studentId) {
      const context = await this.context(payload.studentId, payload);
      student = context.student;
      variables = { ...context.variables, ...variables };
      to ||= student.phone;
    }
    if (!to) throw Object.assign(new Error('Test phone number or student is required'), { status: 400 });
    const rendered = this.renderTemplate(template, variables);
    return messageQueueService.enqueue({
      channel: 'whatsapp', messageType: 'text', to, payload: {
        text: rendered.text, automationTemplateKey: `${key}_test`,
        contactId: student?.contactId, studentName: student?.name, isAutomationTest: true
      }
    }, payload.createdBy || null);
  }

  async dispatchClassReminder(lesson, createdBy = null) {
    if (!lesson.liveClassAt || !lesson.isPublished) return [];
    const enrollments = await StudentEnrollment.findAll({
      where: {
        courseId: lesson.courseId,
        ...(lesson.batchId ? { batchId: lesson.batchId } : {}),
        enrollmentStatus: 'active'
      },
      include: [
        { model: Student, as: 'student', where: { status: { [Op.in]: ['enrolled', 'active'] } } },
        { model: Course, as: 'course' },
        { model: Batch, as: 'batch', required: false }
      ]
    });
    const reminderMinutes = Math.max(0, Number(process.env.LMS_CLASS_REMINDER_MINUTES || 30));
    const scheduledAt = new Date(Math.max(Date.now(), new Date(lesson.liveClassAt).getTime() - reminderMinutes * 60000));
    return Promise.all(enrollments.map((enrollment) => this.dispatch('class_reminder', enrollment.studentId, {
      eventId: `lesson:${lesson.id}:${new Date(lesson.liveClassAt).toISOString()}`,
      eventDate: new Date(lesson.liveClassAt).toISOString().slice(0, 10),
      lessonId: lesson.id, lessonName: lesson.title, liveClassAt: lesson.liveClassAt, scheduledAt, createdBy,
      variables: { course_name: enrollment.course?.name || '', batch_name: enrollment.batch?.name || '' }
    }).catch((error) => ({ status: 'failed', error: error.message }))));
  }

  async dispatchRecording(lesson, createdBy = null) {
    if (!(lesson.recordingUrl || lesson.bunnyEmbedUrl || lesson.bunnyVideoId) || !lesson.isPublished) return [];
    const enrollments = await StudentEnrollment.findAll({
      where: { courseId: lesson.courseId, ...(lesson.batchId ? { batchId: lesson.batchId } : {}), enrollmentStatus: 'active' },
      include: [
        { model: Student, as: 'student', where: { status: { [Op.in]: ['enrolled', 'active'] } } },
        { model: Course, as: 'course' },
        { model: Batch, as: 'batch', required: false }
      ]
    });
    const portal = await this.companyVariables();
    return Promise.all(enrollments.map((enrollment) => this.dispatch('recording_available', enrollment.studentId, {
      eventId: `recording:${lesson.id}:${lesson.updatedAt?.toISOString?.() || lesson.recordingUrl}`,
      lessonId: lesson.id, lessonName: lesson.title,
      recordingUrl: `${portal.portal_url}/lessons/${lesson.id}`, createdBy,
      variables: { course_name: enrollment.course?.name || '', batch_name: enrollment.batch?.name || '' }
    }).catch((error) => ({ status: 'failed', error: error.message }))));
  }
}

module.exports = new StudentMessageAutomationService();
