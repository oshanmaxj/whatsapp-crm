const { Op } = require('sequelize');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {
  Batch, Course, LmsLesson, LmsLessonMaterial, LmsStudentProgress, User
} = require('../models');
const studentMessageAutomationService = require('./studentMessageAutomation.service');

const lessonInclude = () => [
  { model: Course, as: 'course', attributes: ['id', 'name', 'code'] },
  { model: Batch, as: 'batch', required: false, attributes: ['id', 'name', 'code'] },
  { model: User, as: 'lecturer', required: false, attributes: ['id', 'firstName', 'lastName'] },
  { model: LmsLessonMaterial, as: 'materials', required: false }
];

function lessonPayload(payload = {}) {
  const allowed = [
    'courseId', 'batchId', 'title', 'description', 'lessonOrder', 'liveClassAt', 'zoomLink',
    'zoomMeetingId', 'zoomPassword', 'joinButtonLabel', 'allowJoinBeforeMinutes', 'allowJoinAfterMinutes',
    'recordingUrl', 'bunnyVideoId', 'bunnyEmbedUrl', 'embedCode', 'lecturerId', 'isPublished',
    'releaseAt', 'durationMinutes', 'source', 'scheduleId', 'scheduledLessonId',
    'scheduledStartAt', 'scheduledEndAt', 'publishedAt'
  ];
  return Object.fromEntries(allowed
    .filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
    .map((key) => [key, payload[key] === '' ? null : payload[key]]));
}

class LmsService {
  async listLessons(query = {}) {
    const where = {};
    if (query.courseId) where.courseId = query.courseId;
    if (query.batchId) where.batchId = query.batchId;
    if (query.published !== undefined) where.isPublished = String(query.published) === 'true';
    if (query.kind === 'recordings') {
      where[Op.or] = [
        { recordingUrl: { [Op.ne]: null } },
        { bunnyEmbedUrl: { [Op.ne]: null } },
        { bunnyVideoId: { [Op.ne]: null } }
      ];
    }
    return LmsLesson.findAll({ where, include: lessonInclude(), order: [['lesson_order', 'ASC'], ['created_at', 'DESC']] });
  }

  async getLesson(id) {
    const row = await LmsLesson.findByPk(id, { include: lessonInclude() });
    if (!row) throw Object.assign(new Error('LMS lesson not found'), { status: 404 });
    return row;
  }

  async createLesson(payload, userId) {
    if (!payload.title || !payload.courseId) throw Object.assign(new Error('Title and course are required'), { status: 400 });
    if (!await Course.findByPk(payload.courseId)) throw Object.assign(new Error('Course not found'), { status: 400 });
    if (payload.batchId && !await Batch.findByPk(payload.batchId)) throw Object.assign(new Error('Batch not found'), { status: 400 });
    const row = await LmsLesson.create({ ...lessonPayload(payload), createdBy: userId || null });
    if (!payload.skipClassReminder) await studentMessageAutomationService.dispatchClassReminder(row, userId).catch(() => null);
    await studentMessageAutomationService.dispatchRecording(row, userId).catch(() => null);
    return this.getLesson(row.id);
  }

  async updateLesson(id, payload) {
    const row = await this.getLesson(id);
    const hadRecording = Boolean(row.recordingUrl || row.bunnyEmbedUrl || row.bunnyVideoId);
    await row.update(lessonPayload(payload));
    await studentMessageAutomationService.dispatchClassReminder(row, payload.createdBy || null).catch(() => null);
    if (!hadRecording && (row.recordingUrl || row.bunnyEmbedUrl || row.bunnyVideoId)) {
      await studentMessageAutomationService.dispatchRecording(row, payload.createdBy || null).catch(() => null);
    }
    return this.getLesson(id);
  }

  async deleteLesson(id) {
    const row = await this.getLesson(id);
    await LmsStudentProgress.destroy({ where: { lessonId: row.id } });
    await LmsLessonMaterial.destroy({ where: { lessonId: row.id } });
    await row.destroy();
    return { deleted: true, id: row.id };
  }

  async setPublished(id, isPublished) {
    const row = await this.getLesson(id);
    await row.update({ isPublished });
    if (isPublished) {
      await studentMessageAutomationService.dispatchClassReminder(row).catch(() => null);
      await studentMessageAutomationService.dispatchRecording(row).catch(() => null);
    }
    return this.getLesson(id);
  }

  async addMaterial(id, payload) {
    const lesson = await this.getLesson(id);
    if (!payload.title || !payload.fileUrl) throw Object.assign(new Error('Material title and file URL are required'), { status: 400 });
    const materialType = payload.materialType || payload.fileType || 'External Link';
    const allowedTypes = ['PDF', 'DOC', 'XLS', 'PPT', 'ZIP', 'Image', 'Video', 'Audio', 'External Link'];
    if (!allowedTypes.includes(materialType)) throw Object.assign(new Error('Invalid material type'), { status: 400 });
    if (!['all_students', 'specific_course', 'specific_batch'].includes(payload.visibility || 'all_students')) {
      throw Object.assign(new Error('Invalid material visibility'), { status: 400 });
    }
    if (!['draft', 'published'].includes(payload.status || 'published')) {
      throw Object.assign(new Error('Invalid material status'), { status: 400 });
    }
    return LmsLessonMaterial.create({
      lessonId: id,
      courseId: lesson.courseId,
      batchId: lesson.batchId,
      title: String(payload.title).trim(),
      fileUrl: String(payload.fileUrl).trim(),
      fileType: payload.fileType || materialType,
      materialType,
      description: payload.description || null,
      visibility: payload.visibility || 'all_students',
      status: payload.status || 'published'
    });
  }

  async uploadMaterialFile(buffer, originalName, mimeType) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('A file is required'), { status: 400 });
    if (buffer.length > 25 * 1024 * 1024) throw Object.assign(new Error('Material files must be 25 MB or smaller'), { status: 413 });
    const safeOriginal = path.basename(String(originalName || 'material')).replace(/[^a-zA-Z0-9._-]/g, '-');
    const extension = path.extname(safeOriginal).toLowerCase();
    const allowed = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.wav', '.m4a']);
    if (!allowed.has(extension)) throw Object.assign(new Error('This file type is not allowed'), { status: 400 });
    const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
    const directory = path.join(__dirname, '..', '..', 'uploads', 'lms-materials');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, fileName), buffer);
    return {
      fileUrl: `/uploads/lms-materials/${fileName}`,
      fileName: safeOriginal,
      mimeType: mimeType || 'application/octet-stream',
      size: buffer.length
    };
  }

  async deleteMaterial(id) {
    const row = await LmsLessonMaterial.findByPk(id);
    if (!row) throw Object.assign(new Error('Material not found'), { status: 404 });
    await row.destroy();
    return { deleted: true, id: row.id };
  }
}

module.exports = new LmsService();
