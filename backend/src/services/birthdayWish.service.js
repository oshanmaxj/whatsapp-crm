const { Op } = require('sequelize');
const {
  AppSetting,
  BirthdayWish,
  Contact,
  Course,
  Student,
  StudentGuardian
} = require('../models');
const notificationService = require('./notification.service');
const whatsappComplianceService = require('./whatsappCompliance.service');
const whatsappService = require('./whatsapp.service');

const DEFAULT_SETTINGS = {
  birthday_auto_send_enabled: false,
  birthday_send_to_students_enabled: true,
  birthday_send_to_guardians_enabled: true
};

function dateKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function birthdayOccurrence(dateOfBirth, from = new Date()) {
  if (!dateOfBirth) return null;
  const parts = String(dateOfBirth).slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
  const start = new Date(`${dateKey(from)}T00:00:00.000Z`);
  let occurrence = new Date(Date.UTC(start.getUTCFullYear(), parts[1] - 1, parts[2]));
  if (occurrence < start) occurrence = new Date(Date.UTC(start.getUTCFullYear() + 1, parts[1] - 1, parts[2]));
  return dateKey(occurrence);
}

function daysFromToday(value, from = new Date()) {
  const start = new Date(`${dateKey(from)}T00:00:00.000Z`);
  const target = new Date(`${value}T00:00:00.000Z`);
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

class BirthdayWishService {
  include() {
    return [
      {
        model: Student,
        as: 'student',
        include: [{ model: Contact, as: 'contact' }, { model: Course, as: 'course' }]
      },
      { model: StudentGuardian, as: 'guardian' }
    ];
  }

  async settings() {
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: 'birthday_wishes', key: 'automation' },
      defaults: { value: DEFAULT_SETTINGS }
    });
    return { ...DEFAULT_SETTINGS, ...(row.value || {}) };
  }

  async queryWishes(query = {}) {
    const where = {};
    if (query.studentId) where.studentId = query.studentId;
    if (query.guardianId) where.guardianId = query.guardianId;
    if (query.recipientType) where.recipientType = query.recipientType;
    if (query.status) where.status = query.status;
    if (query.date) where.birthdayDate = query.date;
    if (query.fromDate || query.toDate) {
      where.birthdayDate = {};
      if (query.fromDate) where.birthdayDate[Op.gte] = query.fromDate;
      if (query.toDate) where.birthdayDate[Op.lte] = query.toDate;
    }
    return BirthdayWish.findAll({
      where,
      include: this.include(),
      order: [['birthday_date', 'ASC'], ['created_at', 'DESC']],
      limit: 1000
    });
  }

  async list(query = {}) {
    await this.generateBirthdayWishes();
    return this.queryWishes(query);
  }

  history(query = {}) {
    return this.queryWishes(query);
  }

  async getDue() {
    await this.generateBirthdayWishes();
    const rows = await BirthdayWish.findAll({
      where: { status: 'pending' },
      include: this.include(),
      order: [['birthday_date', 'ASC'], ['created_at', 'ASC']]
    });
    const today = dateKey();
    return {
      today: rows.filter((row) => row.birthdayDate === today),
      upcoming: rows.filter((row) => row.birthdayDate > today),
      due: rows.filter((row) => row.birthdayDate <= today)
    };
  }

  async generateBirthdayWishes(baseDate = new Date()) {
    const settings = await this.settings();
    const students = await Student.findAll({
      where: { status: { [Op.in]: ['enrolled', 'active'] } },
      include: [
        { model: Contact, as: 'contact' },
        { model: Course, as: 'course' },
        { model: StudentGuardian, as: 'guardians' }
      ]
    });
    const rows = [];
    for (const student of students) {
      if (settings.birthday_send_to_students_enabled !== false && student.dateOfBirth) {
        const occurrence = birthdayOccurrence(student.dateOfBirth, baseDate);
        if (occurrence && daysFromToday(occurrence, baseDate) <= 30) {
          rows.push(await this.ensureWish(student, null, 'student', occurrence));
        }
      }
      if (settings.birthday_send_to_guardians_enabled !== false) {
        for (const guardian of student.guardians || []) {
          if (!guardian.dateOfBirth) continue;
          const occurrence = birthdayOccurrence(guardian.dateOfBirth, baseDate);
          if (occurrence && daysFromToday(occurrence, baseDate) <= 30) {
            rows.push(await this.ensureWish(student, guardian, 'guardian', occurrence));
          }
        }
      }
    }
    return rows.filter(Boolean);
  }

  async ensureWish(student, guardian, recipientType, birthdayDate) {
    const existing = await BirthdayWish.findOne({
      where: {
        studentId: student.id,
        guardianId: guardian?.id || null,
        recipientType,
        birthdayDate
      }
    });
    if (existing) return existing;
    return BirthdayWish.create({
      studentId: student.id,
      guardianId: guardian?.id || null,
      recipientType,
      birthdayDate,
      status: 'pending',
      channel: 'whatsapp',
      message: await this.messageFor(student, guardian, recipientType)
    });
  }

  async sendManualWish(studentId, payload = {}) {
    if (payload.wishId) {
      const existing = await BirthdayWish.findOne({ where: { id: payload.wishId, studentId } });
      if (!existing) throw Object.assign(new Error('Birthday wish not found'), { status: 404 });
      return this.sendBirthdayWish(existing.id);
    }
    const student = await Student.findByPk(studentId, {
      include: [{ model: Contact, as: 'contact' }, { model: Course, as: 'course' }]
    });
    if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });
    const recipientType = payload.recipientType || 'student';
    if (!['student', 'guardian'].includes(recipientType)) {
      throw Object.assign(new Error('Invalid recipient type'), { status: 400 });
    }
    let guardian = null;
    if (recipientType === 'guardian') {
      guardian = payload.guardianId
        ? await StudentGuardian.findOne({ where: { id: payload.guardianId, studentId } })
        : await StudentGuardian.findOne({ where: { studentId }, order: [['is_primary', 'DESC'], ['created_at', 'ASC']] });
      if (!guardian) throw Object.assign(new Error('Guardian not found'), { status: 404 });
    }
    const wish = await BirthdayWish.create({
      studentId,
      guardianId: guardian?.id || null,
      recipientType,
      birthdayDate: dateKey(),
      status: 'pending',
      channel: 'whatsapp',
      message: String(payload.message || '').trim() || await this.messageFor(student, guardian, recipientType)
    });
    return this.sendBirthdayWish(wish.id);
  }

  async sendBirthdayWish(wishId) {
    const wish = await BirthdayWish.findByPk(wishId, { include: this.include() });
    if (!wish) throw Object.assign(new Error('Birthday wish not found'), { status: 404 });
    if (wish.status === 'sent') return wish;

    const target = wish.recipientType === 'guardian'
      ? {
          name: wish.guardian?.name,
          number: wish.guardian?.whatsapp || wish.guardian?.phone,
          contactId: await this.contactIdForNumber(wish.guardian?.whatsapp || wish.guardian?.phone)
        }
      : {
          name: wish.student?.name,
          number: wish.student?.contact?.whatsappId || wish.student?.phone,
          contactId: wish.student?.contactId || null
        };

    let requiredType = null;
    let validation = null;
    try {
      if (!target.number) {
        await notificationService.create({
          type: 'birthday_wish_setup',
          title: `${wish.recipientType === 'guardian' ? 'Guardian' : 'Student'} WhatsApp missing`,
          message: `${target.name || wish.student?.name || 'Recipient'} has no WhatsApp number configured.`,
          data: { wishId: wish.id, studentId: wish.studentId, guardianId: wish.guardianId }
        });
        throw Object.assign(new Error('Recipient WhatsApp number is missing'), { status: 400 });
      }

      requiredType = target.contactId
        ? await whatsappComplianceService.getRequiredMessageType(target.contactId)
        : 'template';
      validation = await whatsappComplianceService.validateTemplateUsage({
        contactId: target.contactId,
        templateName: 'BIRTHDAY_WISH',
        messageType: requiredType
      });
      if (!validation.allowed) {
        validation = await whatsappComplianceService.validateTemplateUsage({
          contactId: target.contactId,
          templateName: 'birthday_wish',
          messageType: requiredType
        });
      }
      if (!validation.allowed) throw Object.assign(new Error(validation.reason), { status: 400 });

      const message = await this.messageFor(wish.student, wish.guardian, wish.recipientType);
      const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
      let response;
      if (!realSendEnabled) {
        response = { mode: 'simulated', to: target.number, message };
      } else if (requiredType === 'template') {
        response = await whatsappService.sendTemplateMessage({
          to: target.number,
          templateName: validation.template.name,
          language: validation.template.language,
          components: await this.templateComponents(wish)
        });
      } else {
        response = await whatsappService.sendTextMessage({ to: target.number, text: message });
      }

      await wish.update({
        status: 'sent',
        sentDate: new Date(),
        response: { complianceMode: requiredType, validation, response }
      });
      await this.notifyResult(wish, 'sent');
    } catch (error) {
      await wish.update({
        status: 'failed',
        response: {
          complianceMode: requiredType,
          validation,
          error: error.message,
          status: error.response?.status,
          data: error.response?.data
        }
      });
      await this.notifyResult(wish, 'failed', error.message);
    }
    return BirthdayWish.findByPk(wish.id, { include: this.include() });
  }

  async sendBulkBirthdayWishes() {
    const settings = await this.settings();
    if (settings.birthday_auto_send_enabled !== true) {
      return { total: 0, sent: 0, failed: 0, skipped: true, settings, results: [] };
    }
    await this.generateBirthdayWishes();
    const pending = await BirthdayWish.findAll({
      where: { status: 'pending', birthdayDate: { [Op.lte]: dateKey() } },
      order: [['birthday_date', 'ASC'], ['created_at', 'ASC']]
    });
    const results = [];
    for (const wish of pending) {
      results.push(await this.sendBirthdayWish(wish.id).catch((error) => ({ id: wish.id, status: 'failed', error: error.message })));
    }
    return {
      total: results.length,
      sent: results.filter((row) => row.status === 'sent').length,
      failed: results.filter((row) => row.status === 'failed').length,
      results
    };
  }

  async contactIdForNumber(number) {
    if (!number) return null;
    const contact = await Contact.findOne({ where: { [Op.or]: [{ phone: number }, { whatsappId: number }] } });
    return contact?.id || null;
  }

  async messageContext(student, guardian) {
    const companySetting = await AppSetting.findOne({ where: { namespace: 'company', key: 'profile' } });
    return {
      studentName: student?.name || 'Student',
      guardianName: guardian?.name || 'Guardian',
      instituteName: companySetting?.value?.name || process.env.COMPANY_NAME || 'Institute',
      courseName: student?.course?.name || 'your course'
    };
  }

  async messageFor(student, guardian, recipientType) {
    const context = await this.messageContext(student, guardian);
    const recipientName = recipientType === 'guardian' ? context.guardianName : context.studentName;
    return `Happy Birthday ${recipientName}!\n\nWarm wishes from ${context.instituteName}. We hope you have a wonderful year ahead.\n\nCourse: ${context.courseName}`;
  }

  async templateComponents(wish) {
    const context = await this.messageContext(wish.student, wish.guardian);
    return [{
      type: 'body',
      parameters: [
        { type: 'text', text: context.studentName },
        { type: 'text', text: context.guardianName },
        { type: 'text', text: context.instituteName },
        { type: 'text', text: context.courseName }
      ]
    }];
  }

  async notifyResult(wish, status, detail = '') {
    await notificationService.create({
      type: 'birthday_wish',
      title: status === 'sent' ? 'Birthday wish sent' : 'Birthday wish failed',
      message: `${wish.recipientType === 'guardian' ? wish.guardian?.name : wish.student?.name || 'Recipient'}: ${status}${detail ? ` - ${detail}` : ''}`,
      data: { wishId: wish.id, studentId: wish.studentId, guardianId: wish.guardianId, status }
    });
  }

  async getBirthdayWishReport(filters = {}) {
    const rows = await this.history(filters);
    return {
      generated: rows.length,
      sent: rows.filter((row) => row.status === 'sent').length,
      failed: rows.filter((row) => row.status === 'failed').length,
      studentWishes: rows.filter((row) => row.recipientType === 'student').length,
      guardianWishes: rows.filter((row) => row.recipientType === 'guardian').length,
      rows
    };
  }

  report(filters = {}) {
    return this.getBirthdayWishReport(filters);
  }
}

module.exports = new BirthdayWishService();
