const { Op } = require('sequelize');
const {
  sequelize, Batch, Course, LmsTopic, LmsLesson, LmsLessonBatchOverride,
  LmsLessonMaterial, User
} = require('../models');
const audit = require('./audit.service');

const COURSE_FIELDS = [
  'name', 'code', 'category', 'description', 'shortDescription', 'thumbnailUrl', 'introVideoUrl',
  'instructorId', 'difficultyLevel', 'durationMinutes', 'durationWeeks', 'feeAmount', 'lmsStatus',
  'visibility', 'enrollmentStartAt', 'enrollmentEndAt', 'expiresAfterDays', 'lifetimeAccess',
  'dripEnabled', 'defaultDripType', 'certificateEnabled', 'completionPercentageRequired',
  'allowLessonDownloads', 'allowComments', 'courseOrder'
];
const LESSON_FIELDS = [
  'title', 'summary', 'description', 'lessonType', 'lecturerId', 'durationMinutes', 'sortOrder',
  'status', 'contentHtml', 'externalUrl', 'externalButtonLabel', 'openInNewTab', 'documentUrl',
  'documentPreviewEnabled', 'thumbnailUrl', 'downloadAllowed', 'liveClassAt', 'zoomLink',
  'zoomMeetingId', 'zoomPassword', 'joinButtonLabel', 'allowJoinBeforeMinutes', 'allowJoinAfterMinutes',
  'recordingUrl', 'bunnyVideoId', 'bunnyEmbedUrl', 'embedCode', 'dripType', 'dripValue',
  'dripReleaseAt', 'isPublished', 'releaseAt'
];

function pick(payload, fields) {
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(payload, field))
    .map((field) => [field, payload[field] === '' ? null : payload[field]]));
}

function safeLesson(row, { privateFields = false } = {}) {
  const data = row?.toJSON ? row.toJSON() : { ...row };
  if (privateFields) data.hasZoomPassword = Boolean(data.zoomPassword);
  delete data.zoomPassword;
  if (Array.isArray(data.batchOverrides)) data.batchOverrides = data.batchOverrides.map((override) => {
    const safe = { ...override, hasZoomPassword: Boolean(override.zoomPassword) };
    delete safe.zoomPassword;
    return safe;
  });
  if (!privateFields) {
    delete data.zoomLink;
    delete data.zoomMeetingId;
  }
  return data;
}

function lecturerOnly(actor) {
  const roles = (actor?.roles || []).map((role) => String(role).toLowerCase());
  return roles.includes('lecturer') && !roles.some((role) => ['admin', 'manager'].includes(role)) && !actor?.isSystemAdmin;
}

function assertCourseOwnership(course, actor) {
  if (lecturerOnly(actor) && String(course.instructorId || '') !== String(actor.id)) {
    throw Object.assign(new Error('This course is not assigned to you.'), { status: 403 });
  }
}

class LmsCourseBuilderService {
  async listCourses(query = {}, actor = null) {
    const where = {};
    if (lecturerOnly(actor)) where.instructorId = actor.id;
    if (query.status) where.lmsStatus = query.status;
    if (query.search) where[Op.or] = [
      { name: { [Op.iLike]: `%${query.search}%` } },
      { code: { [Op.iLike]: `%${query.search}%` } }
    ];
    const courses = await Course.findAll({
      where, include: [
        { model: Batch, as: 'batches', required: false, attributes: ['id', 'name', 'code', 'status'] },
        { model: User, as: 'instructor', required: false, attributes: ['id', 'firstName', 'lastName'] }
      ], order: [['course_order', 'ASC'], ['name', 'ASC']]
    });
    return Promise.all(courses.map(async (course) => ({
      ...course.toJSON(),
      totalTopics: await LmsTopic.count({ where: { courseId: course.id } }),
      totalLessons: await LmsLesson.count({ where: { courseId: course.id } })
    })));
  }

  async getCourse(id, actor = null) {
    const course = await Course.findByPk(id, { include: [
      { model: Batch, as: 'batches', required: false },
      { model: User, as: 'instructor', required: false, attributes: ['id', 'firstName', 'lastName'] }
    ] });
    if (!course) throw Object.assign(new Error('Course not found.'), { status: 404 });
    assertCourseOwnership(course, actor);
    return course;
  }

  async createCourse(payload, actor) {
    if (!String(payload.name || '').trim()) throw Object.assign(new Error('Course title is required.'), { status: 400 });
    return sequelize.transaction(async (transaction) => {
      const course = await Course.create({ ...pick(payload, COURSE_FIELDS), name: String(payload.name).trim() }, { transaction });
      await audit.record({ userId: actor?.id, action: 'LMS_COURSE_CREATED', entityType: 'course', entityId: course.id, changes: pick(payload, COURSE_FIELDS), transaction, required: true });
      return course;
    });
  }

  async updateCourse(id, payload, actor) {
    return sequelize.transaction(async (transaction) => {
      const course = await Course.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!course) throw Object.assign(new Error('Course not found.'), { status: 404 });
      assertCourseOwnership(course, actor);
      const changes = pick(payload, COURSE_FIELDS);
      await course.update(changes, { transaction });
      await audit.record({ userId: actor?.id, action: 'LMS_COURSE_UPDATED', entityType: 'course', entityId: course.id, changes, transaction, required: true });
      return course;
    });
  }

  async archiveCourse(id, actor) {
    return this.updateCourse(id, { lmsStatus: 'archived' }, actor);
  }

  async duplicateCourse(id, actor) {
    return sequelize.transaction(async (transaction) => {
      const source = await Course.findByPk(id, { transaction });
      if (!source) throw Object.assign(new Error('Course not found.'), { status: 404 });
      const values = pick(source.toJSON(), COURSE_FIELDS);
      values.name = `${source.name} Copy`;
      values.code = null;
      values.lmsStatus = 'draft';
      const copy = await Course.create(values, { transaction });
      const topics = await LmsTopic.findAll({ where: { courseId: source.id }, order: [['sort_order', 'ASC']], transaction });
      for (const topic of topics) {
        const topicCopy = await LmsTopic.create({ courseId: copy.id, title: topic.title, summary: topic.summary, sortOrder: topic.sortOrder, status: 'draft', createdBy: actor?.id }, { transaction });
        const lessons = await LmsLesson.findAll({ where: { topicId: topic.id }, order: [['sort_order', 'ASC']], transaction });
        for (const lesson of lessons) {
          const lessonValues = pick(lesson.toJSON(), LESSON_FIELDS);
          await LmsLesson.create({ ...lessonValues, courseId: copy.id, topicId: topicCopy.id, status: 'draft', isPublished: false, createdBy: actor?.id }, { transaction });
        }
      }
      await audit.record({ userId: actor?.id, action: 'LMS_COURSE_DUPLICATED', entityType: 'course', entityId: copy.id, changes: { sourceCourseId: source.id }, transaction, required: true });
      return copy;
    });
  }

  async curriculum(courseId, options = {}, actor = null) {
    await this.getCourse(courseId, actor);
    const topics = await LmsTopic.findAll({
      where: { courseId },
      include: [{
        model: LmsLesson, as: 'lessons', required: false,
        include: [
          { model: User, as: 'lecturer', required: false, attributes: ['id', 'firstName', 'lastName'] },
          { model: LmsLessonBatchOverride, as: 'batchOverrides', required: false, include: [{ model: Batch, as: 'batch', required: false }] }
        ]
      }],
      order: [['sort_order', 'ASC'], [{ model: LmsLesson, as: 'lessons' }, 'sort_order', 'ASC']]
    });
    return topics.map((topic) => ({ ...topic.toJSON(), lessons: topic.lessons.map((lesson) => safeLesson(lesson, options)) }));
  }

  async createTopic(courseId, payload, actor) {
    if (!String(payload.title || '').trim()) throw Object.assign(new Error('Topic title is required.'), { status: 400 });
    return sequelize.transaction(async (transaction) => {
      const course = await Course.findByPk(courseId, { transaction });
      if (!course) throw Object.assign(new Error('Course not found.'), { status: 404 });
      assertCourseOwnership(course, actor);
      const max = await LmsTopic.max('sortOrder', { where: { courseId }, transaction });
      const topic = await LmsTopic.create({ courseId, title: String(payload.title).trim(), summary: payload.summary || null, sortOrder: payload.sortOrder ?? Number(max || 0) + 1, status: payload.status || 'published', createdBy: actor?.id }, { transaction });
      await audit.record({ userId: actor?.id, action: 'LMS_TOPIC_CREATED', entityType: 'lms_topic', entityId: topic.id, changes: { courseId, title: topic.title }, transaction, required: true });
      return topic;
    });
  }

  async updateTopic(id, payload, actor) {
    const topic = await LmsTopic.findByPk(id);
    if (!topic) throw Object.assign(new Error('Topic not found.'), { status: 404 });
    await this.getCourse(topic.courseId, actor);
    await topic.update({ ...pick(payload, ['title', 'summary', 'status', 'sortOrder']), updatedBy: actor?.id });
    await audit.record({ userId: actor?.id, action: 'LMS_TOPIC_UPDATED', entityType: 'lms_topic', entityId: topic.id, changes: pick(payload, ['title', 'summary', 'status', 'sortOrder']) });
    return topic;
  }

  async archiveTopic(id, actor) {
    const topic = await LmsTopic.findByPk(id);
    if (!topic) throw Object.assign(new Error('Topic not found.'), { status: 404 });
    await this.getCourse(topic.courseId, actor);
    await topic.update({ status: 'archived', updatedBy: actor?.id });
    await topic.destroy();
    await audit.record({ userId: actor?.id, action: 'LMS_TOPIC_ARCHIVED', entityType: 'lms_topic', entityId: topic.id });
    return { archived: true, id: topic.id };
  }

  async reorderTopics(items, actor) {
    return sequelize.transaction(async (transaction) => {
      for (const [index, item] of items.entries()) {
        const topic = await LmsTopic.findByPk(item.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!topic) throw Object.assign(new Error(`Topic ${item.id} not found.`), { status: 404 });
        const course = await Course.findByPk(topic.courseId, { transaction });
        assertCourseOwnership(course, actor);
        await topic.update({ sortOrder: item.sortOrder ?? index, updatedBy: actor?.id }, { transaction });
      }
      await audit.record({ userId: actor?.id, action: 'LMS_TOPICS_REORDERED', entityType: 'lms_topic', changes: { items }, transaction, required: true });
      return { reordered: items.length };
    });
  }

  async duplicateTopic(id, actor) {
    const topic = await LmsTopic.findByPk(id);
    if (!topic) throw Object.assign(new Error('Topic not found.'), { status: 404 });
    await this.getCourse(topic.courseId, actor);
    const copy = await this.createTopic(topic.courseId, { title: `${topic.title} Copy`, summary: topic.summary, status: 'draft' }, actor);
    const lessons = await LmsLesson.findAll({ where: { topicId: topic.id }, order: [['sort_order', 'ASC']] });
    for (const lesson of lessons) await this.createLesson(copy.id, { ...pick(lesson.toJSON(), LESSON_FIELDS), title: lesson.title, status: 'draft' }, actor);
    return copy;
  }

  async getLesson(id, options = {}, actor = null) {
    const lesson = await LmsLesson.findByPk(id, { include: [
      { model: LmsTopic, as: 'topic' }, { model: LmsLessonMaterial, as: 'materials', required: false },
      { model: LmsLessonBatchOverride, as: 'batchOverrides', required: false, include: [{ model: Batch, as: 'batch', required: false }] }
    ] });
    if (!lesson) throw Object.assign(new Error('Lesson not found.'), { status: 404 });
    await this.getCourse(lesson.courseId, actor);
    return safeLesson(lesson, options);
  }

  async createLesson(topicId, payload, actor) {
    return sequelize.transaction(async (transaction) => {
      const topic = await LmsTopic.findByPk(topicId, { transaction });
      if (!topic) throw Object.assign(new Error('Topic not found.'), { status: 404 });
      const course = await Course.findByPk(topic.courseId, { transaction });
      assertCourseOwnership(course, actor);
      if (!String(payload.title || '').trim()) throw Object.assign(new Error('Lesson title is required.'), { status: 400 });
      const max = await LmsLesson.max('sortOrder', { where: { topicId }, transaction });
      const values = pick(payload, LESSON_FIELDS);
      const lesson = await LmsLesson.create({ ...values, courseId: topic.courseId, topicId, title: String(payload.title).trim(), sortOrder: payload.sortOrder ?? Number(max || 0) + 1, lessonOrder: payload.sortOrder ?? Number(max || 0) + 1, isPublished: payload.status === 'published' || payload.isPublished === true, createdBy: actor?.id, updatedBy: actor?.id }, { transaction });
      await this.saveOverrides(lesson.id, payload.batchOverrides, transaction);
      await audit.record({ userId: actor?.id, action: 'LMS_LESSON_CREATED', entityType: 'lms_lesson', entityId: lesson.id, changes: { courseId: topic.courseId, topicId, title: lesson.title }, transaction, required: true });
      return lesson;
    });
  }

  async updateLesson(id, payload, actor) {
    return sequelize.transaction(async (transaction) => {
      const lesson = await LmsLesson.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!lesson) throw Object.assign(new Error('Lesson not found.'), { status: 404 });
      const course = await Course.findByPk(lesson.courseId, { transaction });
      assertCourseOwnership(course, actor);
      const changes = pick(payload, LESSON_FIELDS);
      if (changes.status) changes.isPublished = changes.status === 'published';
      await lesson.update({ ...changes, updatedBy: actor?.id }, { transaction });
      await this.saveOverrides(lesson.id, payload.batchOverrides, transaction);
      await audit.record({ userId: actor?.id, action: 'LMS_LESSON_UPDATED', entityType: 'lms_lesson', entityId: lesson.id, changes: { ...changes, zoomPassword: changes.zoomPassword ? '[REDACTED]' : undefined }, transaction, required: true });
      return lesson;
    });
  }

  async saveOverrides(lessonId, overrides, transaction) {
    if (!Array.isArray(overrides)) return;
    for (const item of overrides) {
      if (!item.batchId) continue;
      const values = pick(item, ['liveClassAt', 'zoomLink', 'zoomMeetingId', 'zoomPassword', 'dripReleaseAt', 'status']);
      const [row] = await LmsLessonBatchOverride.findOrCreate({ where: { lessonId, batchId: item.batchId }, defaults: { lessonId, batchId: item.batchId, ...values }, transaction });
      if (!row.isNewRecord) await row.update(values, { transaction });
    }
  }

  async archiveLesson(id, actor) {
    const lesson = await LmsLesson.findByPk(id);
    if (!lesson) throw Object.assign(new Error('Lesson not found.'), { status: 404 });
    await this.getCourse(lesson.courseId, actor);
    await lesson.update({ status: 'archived', isPublished: false, updatedBy: actor?.id });
    await lesson.destroy();
    await audit.record({ userId: actor?.id, action: 'LMS_LESSON_ARCHIVED', entityType: 'lms_lesson', entityId: lesson.id });
    return { archived: true, id: lesson.id };
  }

  async reorderLessons(items, actor) {
    return sequelize.transaction(async (transaction) => {
      for (const [index, item] of items.entries()) {
        const lesson = await LmsLesson.findByPk(item.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!lesson) throw Object.assign(new Error(`Lesson ${item.id} not found.`), { status: 404 });
        const course = await Course.findByPk(lesson.courseId, { transaction });
        assertCourseOwnership(course, actor);
        const topicId = item.topicId || lesson.topicId;
        const topic = await LmsTopic.findByPk(topicId, { transaction });
        if (!topic || String(topic.courseId) !== String(lesson.courseId)) throw Object.assign(new Error('Lesson cannot move outside its course.'), { status: 400 });
        await lesson.update({ topicId, sortOrder: item.sortOrder ?? index, lessonOrder: item.sortOrder ?? index, updatedBy: actor?.id }, { transaction });
      }
      await audit.record({ userId: actor?.id, action: 'LMS_LESSONS_REORDERED', entityType: 'lms_lesson', changes: { items }, transaction, required: true });
      return { reordered: items.length };
    });
  }

  async moveLesson(id, topicId, sortOrder, actor) {
    await this.reorderLessons([{ id, topicId, sortOrder: sortOrder ?? 0 }], actor);
    return this.getLesson(id, {}, actor);
  }

  async duplicateLesson(id, actor) {
    const source = await LmsLesson.findByPk(id);
    if (!source) throw Object.assign(new Error('Lesson not found.'), { status: 404 });
    await this.getCourse(source.courseId, actor);
    return this.createLesson(source.topicId, { ...pick(source.toJSON(), LESSON_FIELDS), title: `${source.title} Copy`, status: 'draft' }, actor);
  }
}

module.exports = new LmsCourseBuilderService();
module.exports.LmsCourseBuilderService = LmsCourseBuilderService;
module.exports.safeLesson = safeLesson;
