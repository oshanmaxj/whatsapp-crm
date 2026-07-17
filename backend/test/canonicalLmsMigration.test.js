const test = require('node:test');
const assert = require('node:assert/strict');
const Sequelize = require('sequelize');
const migration = require('../migrations/034_canonical_scheduled_lesson_lms_sync');

test('canonical LMS migration is idempotent and creates required integrity indexes', async () => {
  const tables = {
    lms_topics: { id: {}, course_id: {}, title: {} },
    lms_lessons: { id: {}, course_id: {}, scheduled_lesson_id: {} },
    course_schedules: { id: {}, course_id: {} }
  };
  const indexes = {};
  const queryInterface = {
    sequelize: { transaction: async (callback) => callback({}) },
    async describeTable(table) {
      if (!tables[table]) throw new Error('missing table');
      return tables[table];
    },
    async createTable(table, columns) { tables[table] = { ...columns }; },
    async addColumn(table, column, definition) { tables[table][column] = definition; },
    async showIndex(table) { return indexes[table] || []; },
    async addIndex(table, fields, options) {
      indexes[table] ||= [];
      indexes[table].push({ name: options.name, unique: Boolean(options.unique), fields });
    }
  };

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  assert.ok(tables.lms_courses);
  assert.ok(tables.lms_topics.lms_course_id);
  assert.ok(tables.lms_topics.normalized_title);
  assert.ok(tables.lms_lessons.lms_course_id);
  assert.ok(tables.lms_lessons.timezone);
  assert.ok(tables.course_schedules.topic_name);
  assert.equal(indexes.lms_courses.filter((item) => item.name === 'lms_courses_scope_key_unique').length, 1);
  assert.equal(indexes.lms_topics.filter((item) => item.name === 'lms_topics_scope_title_unique').length, 1);
  assert.equal(indexes.lms_lessons.filter((item) => item.name === 'lms_lessons_scheduled_lesson_unique').length, 1);
  assert.equal(indexes.lms_topics.find((item) => item.name === 'lms_topics_scope_title_unique').unique, true);
});
