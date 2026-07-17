require('dotenv').config();

const { Op } = require('sequelize');
const {
  sequelize, Course, LmsTopic, LmsLesson, LmsLessonBatchOverride,
  ScheduledLesson, ZoomRecordingImport
} = require('../models');

const apply = process.argv.includes('--apply');

async function run() {
  await sequelize.authenticate();
  const summary = {
    mode: apply ? 'apply' : 'dry-run', coursesFound: 0, topicsToCreate: 0,
    lessonsToMigrate: 0, recordingsMatched: 0, unmatchedRecordings: 0,
    batchOverridesToCreate: 0, errors: [], warnings: []
  };
  const transaction = await sequelize.transaction();
  try {
    const courses = await Course.findAll({ transaction, paranoid: false });
    const lessons = await LmsLesson.findAll({ where: { topicId: null }, transaction, paranoid: false });
    const recordings = await ZoomRecordingImport.findAll({
      where: { [Op.or]: [{ playUrl: { [Op.ne]: null } }, { storageUrl: { [Op.ne]: null } }, { downloadUrl: { [Op.ne]: null } }] },
      transaction
    });
    summary.coursesFound = courses.length;
    summary.lessonsToMigrate = lessons.length;
    summary.topicsToCreate = new Set(lessons.map((lesson) => String(lesson.courseId))).size;
    summary.batchOverridesToCreate = lessons.filter((lesson) => lesson.batchId).length;

    const matches = [];
    const unmatched = [];
    for (const recording of recordings) {
      let lesson = recording.lessonId ? await LmsLesson.findByPk(recording.lessonId, { transaction, paranoid: false }) : null;
      const scheduled = recording.scheduledLessonId
        ? await ScheduledLesson.findByPk(recording.scheduledLessonId, { transaction }) : null;
      if (!lesson && scheduled?.lessonId) lesson = await LmsLesson.findByPk(scheduled.lessonId, { transaction, paranoid: false });
      if (!lesson && recording.zoomMeetingId) {
        lesson = await LmsLesson.findOne({ where: { zoomMeetingId: recording.zoomMeetingId }, transaction, paranoid: false });
      }
      if (lesson) matches.push({ recording, lesson, scheduled });
      else unmatched.push({ recording, scheduled });
    }
    summary.recordingsMatched = matches.length;
    summary.unmatchedRecordings = unmatched.length;
    if (!apply) {
      await transaction.rollback();
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    }

    const topicByCourse = new Map();
    for (const lesson of lessons) {
      let topic = topicByCourse.get(String(lesson.courseId));
      if (!topic) {
        [topic] = await LmsTopic.findOrCreate({
          where: { courseId: lesson.courseId, title: 'General Lessons' },
          defaults: { courseId: lesson.courseId, title: 'General Lessons', summary: 'Lessons migrated from the legacy LMS.', sortOrder: 0, status: 'published' },
          transaction
        });
        topicByCourse.set(String(lesson.courseId), topic);
      }
      await lesson.update({
        topicId: topic.id,
        sortOrder: lesson.lessonOrder || 0,
        lessonType: lesson.liveClassAt ? 'live_class' : (lesson.recordingUrl || lesson.bunnyEmbedUrl || lesson.bunnyVideoId ? 'video' : 'text'),
        status: lesson.isPublished ? 'published' : 'draft'
      }, { transaction });
      if (lesson.batchId) {
        await LmsLessonBatchOverride.findOrCreate({
          where: { lessonId: lesson.id, batchId: lesson.batchId },
          defaults: {
            lessonId: lesson.id, batchId: lesson.batchId, liveClassAt: lesson.liveClassAt,
            zoomLink: lesson.zoomLink, zoomMeetingId: lesson.zoomMeetingId,
            zoomPassword: lesson.zoomPassword, dripReleaseAt: lesson.releaseAt,
            status: lesson.isPublished ? 'published' : 'draft'
          }, transaction
        });
      }
    }

    for (const { recording, lesson } of matches) {
      await lesson.update({
        recordingUrl: lesson.recordingUrl || recording.storageUrl || recording.playUrl || recording.downloadUrl,
        embedCode: lesson.embedCode || recording.embedCode,
        durationMinutes: lesson.durationMinutes || recording.durationMinutes,
        lessonType: 'video'
      }, { transaction });
    }

    for (const { recording, scheduled } of unmatched) {
      const courseId = scheduled?.courseId;
      if (!courseId) {
        summary.warnings.push(`Recording ${recording.id} has no safely identifiable course and was retained in zoom_recording_imports.`);
        continue;
      }
      const [topic] = await LmsTopic.findOrCreate({
        where: { courseId, title: 'Recordings' },
        defaults: { courseId, title: 'Recordings', summary: 'Recordings preserved during LMS curriculum migration.', sortOrder: 999, status: 'published' },
        transaction
      });
      const existing = scheduled?.id
        ? await LmsLesson.findOne({ where: { scheduledLessonId: scheduled.id }, transaction, paranoid: false })
        : null;
      if (!existing) {
        const created = await LmsLesson.create({
          courseId, topicId: topic.id, batchId: scheduled?.batchId || null,
          title: recording.topic || scheduled?.title || `Recording ${recording.id}`,
          summary: 'Recording migrated from the legacy Zoom recording import.', lessonType: 'video',
          recordingUrl: recording.storageUrl || recording.playUrl || recording.downloadUrl,
          embedCode: recording.embedCode, durationMinutes: recording.durationMinutes,
          sortOrder: 0, lessonOrder: 0, status: 'published', isPublished: true,
          scheduledLessonId: scheduled?.id || null, source: 'zoom_recording_migration',
          liveClassAt: scheduled?.scheduledStartAt || recording.startTime || null
        }, { transaction });
        if (scheduled?.batchId) {
          await LmsLessonBatchOverride.findOrCreate({
            where: { lessonId: created.id, batchId: scheduled.batchId },
            defaults: { lessonId: created.id, batchId: scheduled.batchId, liveClassAt: scheduled.scheduledStartAt, status: 'published' },
            transaction
          });
        }
      }
    }
    await transaction.commit();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    summary.errors.push({ message: error.message, code: error.original?.code || error.code || null });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    throw error;
  } finally {
    await sequelize.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
