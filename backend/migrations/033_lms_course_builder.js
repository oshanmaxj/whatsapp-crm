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
      const existingCourseColumns = await queryInterface.describeTable('courses', { transaction });
      const lmsStatusWasMissing = !existingCourseColumns.lms_status;
      const courseColumns = {
        short_description: { type: D.STRING(500), allowNull: true },
        thumbnail_url: { type: D.TEXT, allowNull: true }, intro_video_url: { type: D.TEXT, allowNull: true },
        instructor_id: { type: D.BIGINT, allowNull: true }, difficulty_level: { type: D.STRING(20), allowNull: false, defaultValue: 'beginner' },
        duration_minutes: { type: D.INTEGER, allowNull: true }, lms_status: { type: D.STRING(20), allowNull: false, defaultValue: 'draft' },
        visibility: { type: D.STRING(30), allowNull: false, defaultValue: 'enrolled' }, enrollment_start_at: { type: D.DATE, allowNull: true },
        enrollment_end_at: { type: D.DATE, allowNull: true }, expires_after_days: { type: D.INTEGER, allowNull: true },
        lifetime_access: { type: D.BOOLEAN, allowNull: false, defaultValue: true }, drip_enabled: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        default_drip_type: { type: D.STRING(40), allowNull: false, defaultValue: 'immediate' }, certificate_enabled: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        completion_percentage_required: { type: D.INTEGER, allowNull: false, defaultValue: 100 }, allow_lesson_downloads: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        allow_comments: { type: D.BOOLEAN, allowNull: false, defaultValue: true }, course_order: { type: D.INTEGER, allowNull: false, defaultValue: 0 }
      };
      for (const [column, definition] of Object.entries(courseColumns)) await addColumn(queryInterface, 'courses', column, definition, transaction);
      if (lmsStatusWasMissing) {
        await queryInterface.sequelize.query("UPDATE courses SET lms_status = CASE WHEN status = 'active' THEN 'published' ELSE 'draft' END", { transaction });
      }

      if (!await tableExists(queryInterface, 'lms_topics', transaction)) {
        await queryInterface.createTable('lms_topics', {
          id: { type: D.BIGINT, autoIncrement: true, primaryKey: true }, course_id: { type: D.BIGINT, allowNull: false, references: { model: 'courses', key: 'id' }, onDelete: 'CASCADE' },
          title: { type: D.STRING(255), allowNull: false }, summary: { type: D.TEXT, allowNull: true }, sort_order: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
          status: { type: D.STRING(20), allowNull: false, defaultValue: 'published' }, created_by: { type: D.BIGINT, allowNull: true }, updated_by: { type: D.BIGINT, allowNull: true },
          created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, deleted_at: { type: D.DATE, allowNull: true }
        }, { transaction });
      }

      const lessonColumns = {
        topic_id: { type: D.BIGINT, allowNull: true, references: { model: 'lms_topics', key: 'id' }, onDelete: 'SET NULL' }, summary: { type: D.TEXT, allowNull: true }, lesson_type: { type: D.STRING(30), allowNull: false, defaultValue: 'video' },
        content_html: { type: D.TEXT, allowNull: true }, external_url: { type: D.TEXT, allowNull: true }, external_button_label: { type: D.STRING(100), allowNull: true },
        open_in_new_tab: { type: D.BOOLEAN, allowNull: false, defaultValue: true }, document_url: { type: D.TEXT, allowNull: true }, document_preview_enabled: { type: D.BOOLEAN, allowNull: false, defaultValue: true },
        thumbnail_url: { type: D.TEXT, allowNull: true }, download_allowed: { type: D.BOOLEAN, allowNull: false, defaultValue: false }, sort_order: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        status: { type: D.STRING(20), allowNull: false, defaultValue: 'draft' }, drip_type: { type: D.STRING(40), allowNull: false, defaultValue: 'immediate' },
        drip_value: { type: D.INTEGER, allowNull: true }, drip_release_at: { type: D.DATE, allowNull: true }, updated_by: { type: D.BIGINT, allowNull: true }, deleted_at: { type: D.DATE, allowNull: true }
      };
      for (const [column, definition] of Object.entries(lessonColumns)) await addColumn(queryInterface, 'lms_lessons', column, definition, transaction);
      await queryInterface.sequelize.query("UPDATE lms_lessons SET sort_order = lesson_order, status = CASE WHEN is_published THEN 'published' ELSE 'draft' END WHERE topic_id IS NULL", { transaction });

      if (!await tableExists(queryInterface, 'lms_lesson_batch_overrides', transaction)) {
        await queryInterface.createTable('lms_lesson_batch_overrides', {
          id: { type: D.BIGINT, autoIncrement: true, primaryKey: true }, lesson_id: { type: D.BIGINT, allowNull: false, references: { model: 'lms_lessons', key: 'id' }, onDelete: 'CASCADE' }, batch_id: { type: D.BIGINT, allowNull: false, references: { model: 'batches', key: 'id' }, onDelete: 'CASCADE' },
          live_class_at: { type: D.DATE, allowNull: true }, zoom_link: { type: D.TEXT, allowNull: true }, zoom_meeting_id: { type: D.STRING(120), allowNull: true }, zoom_password: { type: D.TEXT, allowNull: true },
          drip_release_at: { type: D.DATE, allowNull: true }, status: { type: D.STRING(20), allowNull: false, defaultValue: 'published' },
          created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
        }, { transaction });
      }

      const progressColumns = {
        course_id: { type: D.BIGINT, allowNull: true }, topic_id: { type: D.BIGINT, allowNull: true },
        status: { type: D.STRING(20), allowNull: false, defaultValue: 'not_started' }, started_at: { type: D.DATE, allowNull: true }
      };
      for (const [column, definition] of Object.entries(progressColumns)) await addColumn(queryInterface, 'lms_student_progress', column, definition, transaction);
      await queryInterface.sequelize.query("UPDATE lms_student_progress SET status = CASE WHEN is_completed THEN 'completed' WHEN opened_at IS NOT NULL THEN 'in_progress' ELSE 'not_started' END, started_at = opened_at WHERE started_at IS NULL", { transaction });

      await addIndex(queryInterface, 'lms_topics', ['course_id'], { name: 'lms_topics_course_idx' }, transaction);
      await addIndex(queryInterface, 'lms_topics', ['course_id', 'sort_order'], { name: 'lms_topics_course_order_idx' }, transaction);
      await addIndex(queryInterface, 'lms_lessons', ['topic_id'], { name: 'lms_lessons_topic_idx' }, transaction);
      await addIndex(queryInterface, 'lms_lessons', ['course_id'], { name: 'lms_lessons_course_idx' }, transaction);
      await addIndex(queryInterface, 'lms_lessons', ['topic_id', 'sort_order'], { name: 'lms_lessons_topic_order_idx' }, transaction);
      await addIndex(queryInterface, 'lms_lesson_batch_overrides', ['lesson_id', 'batch_id'], { name: 'lms_lesson_batch_override_unique', unique: true }, transaction);
      await addIndex(queryInterface, 'lms_student_progress', ['student_id', 'lesson_id'], { name: 'lms_progress_student_lesson_v2_unique', unique: true }, transaction);
    });
  },
  async down() {}
};
