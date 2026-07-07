async function tableExists(queryInterface, tableName) {
  return Boolean(await queryInterface.describeTable(tableName).catch(() => null));
}

async function addColumn(queryInterface, tableName, columnName, definition) {
  const description = await queryInterface.describeTable(tableName);
  if (!description[columnName]) await queryInterface.addColumn(tableName, columnName, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    await addColumn(queryInterface, 'students', 'portal_password_hash', { type: DataTypes.STRING(255), allowNull: true });

    if (!await tableExists(queryInterface, 'lms_lessons')) {
      await queryInterface.createTable('lms_lessons', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        batch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        title: { type: DataTypes.STRING(255), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        lesson_order: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        live_class_at: { type: DataTypes.DATE, allowNull: true },
        zoom_link: { type: DataTypes.TEXT, allowNull: true },
        recording_url: { type: DataTypes.TEXT, allowNull: true },
        bunny_video_id: { type: DataTypes.STRING(255), allowNull: true },
        bunny_embed_url: { type: DataTypes.TEXT, allowNull: true },
        embed_code: { type: DataTypes.TEXT, allowNull: true },
        lecturer_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        is_published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        release_at: { type: DataTypes.DATE, allowNull: true },
        duration_minutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('lms_lessons', ['course_id', 'batch_id', 'is_published', 'release_at'], { name: 'lms_lessons_access_idx' });
      await queryInterface.addIndex('lms_lessons', ['live_class_at'], { name: 'lms_lessons_live_class_idx' });
    }

    if (!await tableExists(queryInterface, 'lms_lesson_materials')) {
      await queryInterface.createTable('lms_lesson_materials', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        lesson_id: { type: DataTypes.BIGINT, allowNull: false },
        title: { type: DataTypes.STRING(255), allowNull: false },
        file_url: { type: DataTypes.TEXT, allowNull: false },
        file_type: { type: DataTypes.STRING(100), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('lms_lesson_materials', ['lesson_id'], { name: 'lms_materials_lesson_idx' });
    }

    if (!await tableExists(queryInterface, 'lms_student_progress')) {
      await queryInterface.createTable('lms_student_progress', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        lesson_id: { type: DataTypes.BIGINT, allowNull: false },
        opened_at: { type: DataTypes.DATE, allowNull: true },
        last_watched_seconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        watched_percentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
        is_completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        completed_at: { type: DataTypes.DATE, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('lms_student_progress', ['student_id', 'lesson_id'], { name: 'lms_progress_student_lesson_unique', unique: true });
    }

    if (!await tableExists(queryInterface, 'student_portal_sessions')) {
      await queryInterface.createTable('student_portal_sessions', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
        otp_hash: { type: DataTypes.STRING(255), allowNull: true },
        otp_expires_at: { type: DataTypes.DATE, allowNull: true },
        verified_at: { type: DataTypes.DATE, allowNull: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        revoked_at: { type: DataTypes.DATE, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('student_portal_sessions', ['student_id', 'expires_at'], { name: 'student_portal_sessions_student_expiry_idx' });
    }
  },
  async down() {
    // LMS records are intentionally retained.
  }
};
