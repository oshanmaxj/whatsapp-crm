async function tableExists(queryInterface, table) {
  return Boolean(await queryInterface.describeTable(table).catch(() => null));
}

async function addColumn(queryInterface, table, column, definition) {
  const columns = await queryInterface.describeTable(table).catch(() => null);
  if (columns && !columns[column]) await queryInterface.addColumn(table, column, definition);
}

async function addIndex(queryInterface, table, fields, options) {
  const indexes = await queryInterface.showIndex(table).catch(() => []);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(table, fields, options);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const timestamp = { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };

    if (!await tableExists(queryInterface, 'course_schedules')) {
      await queryInterface.createTable('course_schedules', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        batch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        title_prefix: { type: DataTypes.STRING(255), allowNull: false },
        start_date: { type: DataTypes.DATEONLY, allowNull: false },
        end_date: { type: DataTypes.DATEONLY, allowNull: false },
        class_days: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
        start_time: { type: DataTypes.TIME, allowNull: false },
        end_time: { type: DataTypes.TIME, allowNull: false },
        timezone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Asia/Colombo' },
        instructor_name: { type: DataTypes.STRING(180), allowNull: true },
        meeting_provider: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'zoom' },
        zoom_meeting_id: { type: DataTypes.STRING(120), allowNull: true },
        zoom_join_url: { type: DataTypes.TEXT, allowNull: true },
        zoom_start_url: { type: DataTypes.TEXT, allowNull: true },
        auto_create_lessons: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        auto_import_recordings: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        reminder_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'active' },
        created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        created_at: timestamp,
        updated_at: timestamp
      });
    }

    if (!await tableExists(queryInterface, 'scheduled_lessons')) {
      await queryInterface.createTable('scheduled_lessons', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        schedule_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        lesson_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        batch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        lesson_number: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        title: { type: DataTypes.STRING(255), allowNull: false },
        scheduled_start_at: { type: DataTypes.DATE, allowNull: false },
        scheduled_end_at: { type: DataTypes.DATE, allowNull: false },
        timezone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Asia/Colombo' },
        zoom_meeting_id: { type: DataTypes.STRING(120), allowNull: true },
        zoom_join_url: { type: DataTypes.TEXT, allowNull: true },
        status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'scheduled' },
        recording_import_status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'pending' },
        created_at: timestamp,
        updated_at: timestamp
      });
    }

    if (!await tableExists(queryInterface, 'zoom_recording_imports')) {
      await queryInterface.createTable('zoom_recording_imports', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        scheduled_lesson_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        lesson_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        zoom_meeting_id: { type: DataTypes.STRING(120), allowNull: false },
        zoom_uuid: { type: DataTypes.STRING(255), allowNull: true },
        topic: { type: DataTypes.STRING(255), allowNull: true },
        start_time: { type: DataTypes.DATE, allowNull: true },
        duration_minutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        recording_file_id: { type: DataTypes.STRING(255), allowNull: true },
        recording_type: { type: DataTypes.STRING(80), allowNull: true },
        download_url: { type: DataTypes.TEXT, allowNull: true },
        play_url: { type: DataTypes.TEXT, allowNull: true },
        file_size: { type: DataTypes.BIGINT, allowNull: true },
        status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'found' },
        storage_provider: { type: DataTypes.STRING(30), allowNull: true },
        storage_url: { type: DataTypes.TEXT, allowNull: true },
        embed_code: { type: DataTypes.TEXT, allowNull: true },
        error_message: { type: DataTypes.TEXT, allowNull: true },
        created_at: timestamp,
        updated_at: timestamp
      });
    }

    if (!await tableExists(queryInterface, 'lesson_auto_publish_logs')) {
      await queryInterface.createTable('lesson_auto_publish_logs', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        lesson_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        scheduled_lesson_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        action: { type: DataTypes.STRING(80), allowNull: false },
        message: { type: DataTypes.TEXT, allowNull: true },
        created_at: timestamp,
        updated_at: timestamp
      });
    }

    await addIndex(queryInterface, 'course_schedules', ['course_id', 'batch_id', 'status'], { name: 'course_schedules_scope_idx' });
    await addIndex(queryInterface, 'scheduled_lessons', ['schedule_id', 'scheduled_start_at'], { name: 'scheduled_lessons_schedule_date_unique', unique: true });
    await addIndex(queryInterface, 'scheduled_lessons', ['recording_import_status', 'scheduled_end_at'], { name: 'scheduled_lessons_recording_check_idx' });
    await addIndex(queryInterface, 'zoom_recording_imports', ['recording_file_id'], { name: 'zoom_recording_file_unique', unique: true });
    await addIndex(queryInterface, 'lesson_auto_publish_logs', ['scheduled_lesson_id', 'created_at'], { name: 'lesson_publish_logs_scheduled_idx' });

    await addColumn(queryInterface, 'lms_lessons', 'source', { type: DataTypes.STRING(50), allowNull: true });
    await addColumn(queryInterface, 'lms_lessons', 'schedule_id', { type: DataTypes.BIGINT.UNSIGNED, allowNull: true });
    await addColumn(queryInterface, 'lms_lessons', 'scheduled_lesson_id', { type: DataTypes.BIGINT.UNSIGNED, allowNull: true });
    await addColumn(queryInterface, 'lms_lessons', 'scheduled_start_at', { type: DataTypes.DATE, allowNull: true });
    await addColumn(queryInterface, 'lms_lessons', 'scheduled_end_at', { type: DataTypes.DATE, allowNull: true });
    await addColumn(queryInterface, 'lms_lessons', 'published_at', { type: DataTypes.DATE, allowNull: true });
    await addIndex(queryInterface, 'lms_lessons', ['scheduled_lesson_id'], { name: 'lms_lessons_scheduled_lesson_unique', unique: true });

    if (await tableExists(queryInterface, 'student_message_templates')) {
      await queryInterface.bulkUpdate('student_message_templates', {
        body: [
          'Hello {{student_name}},',
          '{{course_name}} - {{batch_name}} class starts at {{class_time}} on {{class_date}}.',
          '',
          '{{lesson_title}}',
          'Login to the LMS to join:',
          '{{portal_lesson_link}}'
        ].join('\n'),
        updated_at: new Date()
      }, { key: 'class_reminder' });
      await queryInterface.bulkUpdate('student_message_templates', {
        body: [
          'Hello {{student_name}},',
          '{{lesson_title}} recording is now published in your LMS.',
          '',
          'Watch the recording:',
          '{{recording_link}}'
        ].join('\n'),
        updated_at: new Date()
      }, { key: 'recording_available' });
    }
  },
  async down() {
    // Data-retaining migration.
  }
};
