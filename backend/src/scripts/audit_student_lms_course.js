require('../config/loadEnv');

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

const courseId = Number(process.argv[2]);

if (!Number.isInteger(courseId) || courseId <= 0) {
  throw new Error('Usage: node src/scripts/audit_student_lms_course.js <course-id>');
}

async function query(sql, replacements = {}) {
  return sequelize.query(sql, {
    type: QueryTypes.SELECT,
    replacements
  });
}

async function main() {
  const courses = await query(`
    SELECT id, name, code, lms_status, deleted_at
    FROM courses
    WHERE id = :courseId
       OR LOWER(name) = LOWER('Trading Master Course Advance')
    ORDER BY id
  `, { courseId });

  const topics = await query(`
    SELECT
      t.id, t.course_id, t.lms_course_id, t.title, t.sort_order, t.status,
      t.deleted_at,
      COUNT(l.id) AS lesson_count
    FROM lms_topics t
    LEFT JOIN lms_lessons l
      ON l.topic_id = t.id
     AND l.deleted_at IS NULL
    WHERE t.course_id = :courseId OR t.lms_course_id = :courseId
    GROUP BY
      t.id, t.course_id, t.lms_course_id, t.title, t.sort_order, t.status,
      t.deleted_at
    ORDER BY t.course_id, t.sort_order, t.id
  `, { courseId });

  const lessons = await query(`
    SELECT
      l.id, l.course_id, l.lms_course_id, l.topic_id, l.batch_id, l.title,
      l.sort_order, l.lesson_order, l.status, l.is_published, l.release_at,
      l.drip_type, l.drip_release_at, l.deleted_at
    FROM lms_lessons l
    WHERE l.course_id = :courseId OR l.lms_course_id = :courseId
    ORDER BY l.topic_id, l.sort_order, l.lesson_order, l.id
  `, { courseId });

  process.stdout.write(`${JSON.stringify({ courses, topics, lessons }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
