require('dotenv').config();

const { sequelize, CourseSchedule, LmsLesson, ScheduledLesson } = require('../models');
const { syncScheduledLessonToLms } = require('../services/scheduledLessonLmsSync.service');

async function run({ dryRun = false } = {}) {
  await sequelize.authenticate();
  const scheduledLessons = await ScheduledLesson.findAll({
    include: [{ model: CourseSchedule, as: 'schedule', required: false }],
    order: [['id', 'ASC']]
  });
  const linkedIds = new Set((await LmsLesson.findAll({
    where: { scheduledLessonId: scheduledLessons.map((row) => row.id) },
    attributes: ['scheduledLessonId']
  })).map((row) => String(row.scheduledLessonId)));

  const result = {
    scanned: scheduledLessons.length,
    alreadyLinked: scheduledLessons.filter((row) => linkedIds.has(String(row.id))).length,
    missing: scheduledLessons.filter((row) => !linkedIds.has(String(row.id))).length,
    synchronized: 0,
    dryRun
  };
  if (dryRun) return result;

  for (const scheduledLesson of scheduledLessons) {
    await sequelize.transaction(async (transaction) => {
      await syncScheduledLessonToLms({ scheduledLesson, transaction, actorUserId: null });
    });
    result.synchronized += 1;
  }
  return result;
}

if (require.main === module) {
  run({ dryRun: process.argv.includes('--dry-run') })
    .then((result) => { console.log(JSON.stringify(result, null, 2)); process.exit(0); })
    .catch((error) => { console.error('Scheduled lesson LMS backfill failed:', error); process.exit(1); });
}

module.exports = { run };
