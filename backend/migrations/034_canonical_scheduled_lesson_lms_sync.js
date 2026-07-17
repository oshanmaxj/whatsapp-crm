async function tableExists(queryInterface, table, transaction) {
  return Boolean(await queryInterface.describeTable(table, { transaction }).catch(() => null));
}

async function addColumn(queryInterface, table, column, definition, transaction) {
  const columns = await queryInterface.describeTable(table, { transaction });
  if (!columns[column]) await queryInterface.addColumn(table, column, definition, { transaction });
}

async function addIndex(queryInterface, table, fields, options, transaction) {
  const indexes = await queryInterface.showIndex(table, { transaction }).catch(() => []);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(table, fields, { ...options, transaction });
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const D = Sequelize.DataTypes;
    return queryInterface.sequelize.transaction(async (transaction) => {
      if (!await tableExists(queryInterface, 'lms_courses', transaction)) {
        await queryInterface.createTable('lms_courses', {
          id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
          course_id: { type: D.BIGINT, allowNull: false, references: { model: 'courses', key: 'id' }, onDelete: 'CASCADE' },
          batch_id: { type: D.BIGINT, allowNull: true, references: { model: 'batches', key: 'id' }, onDelete: 'SET NULL' },
          scope_key: { type: D.STRING(100), allowNull: false },
          title: { type: D.STRING(255), allowNull: false }, description: { type: D.TEXT, allowNull: true },
          instructor_id: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
          status: { type: D.STRING(20), allowNull: false, defaultValue: 'published' },
          is_published: { type: D.BOOLEAN, allowNull: false, defaultValue: true },
          created_by: { type: D.BIGINT, allowNull: true }, updated_by: { type: D.BIGINT, allowNull: true },
          created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
          updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
          deleted_at: { type: D.DATE, allowNull: true }
        }, { transaction });
      }

      await addColumn(queryInterface, 'lms_topics', 'lms_course_id', { type: D.BIGINT, allowNull: true, references: { model: 'lms_courses', key: 'id' }, onDelete: 'SET NULL' }, transaction);
      await addColumn(queryInterface, 'lms_topics', 'normalized_title', { type: D.STRING(255), allowNull: true }, transaction);
      await addColumn(queryInterface, 'lms_lessons', 'lms_course_id', { type: D.BIGINT, allowNull: true, references: { model: 'lms_courses', key: 'id' }, onDelete: 'SET NULL' }, transaction);
      await addColumn(queryInterface, 'lms_lessons', 'timezone', { type: D.STRING(80), allowNull: false, defaultValue: 'Asia/Colombo' }, transaction);
      await addColumn(queryInterface, 'lms_lessons', 'instructor_name', { type: D.STRING(180), allowNull: true }, transaction);

      const scheduleColumns = {
        instructor_id: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        topic_name: { type: D.STRING(255), allowNull: false, defaultValue: 'Live Classes' },
        zoom_password: { type: D.STRING(120), allowNull: true },
        join_button_label: { type: D.STRING(80), allowNull: false, defaultValue: 'Join Live Class' },
        allow_join_before_minutes: { type: D.INTEGER, allowNull: false, defaultValue: 30 },
        allow_join_after_minutes: { type: D.INTEGER, allowNull: false, defaultValue: 150 }
      };
      for (const [column, definition] of Object.entries(scheduleColumns)) {
        await addColumn(queryInterface, 'course_schedules', column, definition, transaction);
      }

      await addIndex(queryInterface, 'lms_courses', ['scope_key'], { name: 'lms_courses_scope_key_unique', unique: true }, transaction);
      await addIndex(queryInterface, 'lms_courses', ['course_id', 'batch_id'], { name: 'lms_courses_course_batch_idx' }, transaction);
      await addIndex(queryInterface, 'lms_topics', ['lms_course_id', 'normalized_title'], { name: 'lms_topics_scope_title_unique', unique: true }, transaction);
      await addIndex(queryInterface, 'lms_lessons', ['lms_course_id'], { name: 'lms_lessons_lms_course_idx' }, transaction);
      await addIndex(queryInterface, 'lms_lessons', ['batch_id'], { name: 'lms_lessons_batch_idx' }, transaction);
      await addIndex(queryInterface, 'lms_lessons', ['lecturer_id'], { name: 'lms_lessons_instructor_idx' }, transaction);
      await addIndex(queryInterface, 'lms_courses', ['instructor_id'], { name: 'lms_courses_instructor_idx' }, transaction);
      await addIndex(queryInterface, 'lms_lessons', ['scheduled_lesson_id'], { name: 'lms_lessons_scheduled_lesson_unique', unique: true }, transaction);
    });
  },

  async down() {
    // Data-retaining migration. Rollback is performed by reverting application code after unpublishing scoped lessons.
  }
};
