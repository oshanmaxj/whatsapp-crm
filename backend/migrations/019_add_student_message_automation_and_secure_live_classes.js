async function describe(queryInterface, table) {
  return queryInterface.describeTable(table).catch(() => null);
}

async function addColumn(queryInterface, table, column, definition) {
  const columns = await describe(queryInterface, table);
  if (columns && !columns[column]) await queryInterface.addColumn(table, column, definition);
}

const templates = [
  ['Student Welcome', 'student_welcome', 'Student', '🎓 Welcome to {{company_name}}\n\nStudent Name: {{student_name}}\nRegistration No: {{registration_number}}\nCourse: {{course_name}}\nBatch: {{batch_name}}\n\nStudent Portal:\n{{portal_url}}\n\nLogin Email:\n{{email}}\n\nPassword:\n{{portal_password}}\n\nSupport:\n{{company_phone}}', [{ type: 'url', title: 'Open LMS', url: '{{portal_url}}' }]],
  ['LMS User Guide', 'lms_user_guide', 'Student', '📚 LMS User Guide\n\nLogin to your student portal and open your course lessons.\nYou can join live classes, watch recordings, and track your progress.', [{ type: 'url', title: 'Open LMS', url: '{{portal_url}}' }]],
  ['Class Reminder', 'class_reminder', 'Class', '⏰ Class Reminder\n\nCourse: {{course_name}}\nBatch: {{batch_name}}\nDate: {{class_date}}\nTime: {{class_time}}\n\nPlease login to your LMS and click Join Class.', [{ type: 'url', title: 'Open LMS', url: '{{portal_url}}/lessons/{{lesson_id}}' }]],
  ['Recording Available', 'recording_available', 'Class', '🎥 Recording Available\n\nLesson: {{lesson_name}}\nRecording is now available in your LMS.', [{ type: 'url', title: 'Watch Recording', url: '{{recording_url}}' }]],
  ['Payment Reminder', 'payment_reminder', 'Payment', '💳 Payment Reminder\n\nInstallment: {{installment_no}}\nAmount: {{payment_amount}}\nDue Date: {{installment_due_date}}\n\nPlease complete your payment before the due date to avoid LMS access restrictions.', []],
  ['Payment Confirmation', 'payment_confirmation', 'Payment', '✅ Payment Received\n\nAmount: {{payment_amount}}\nDate: {{payment_date}}\nMethod: {{payment_method}}\n\nThank you.', []],
  ['Birthday Wish', 'birthday_wish', 'Student', '🎂 Happy Birthday {{student_name}}!\n\nWe wish you success, happiness, and prosperity.\n\n- {{company_name}}', []],
  ['Certificate Issued', 'certificate_issued', 'Certificate', '🏆 Congratulations {{student_name}}!\n\nYour certificate for {{course_name}} is now available.', [{ type: 'url', title: 'Download Certificate', url: '{{certificate_url}}' }]]
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    if (!await describe(queryInterface, 'student_message_templates')) {
      await queryInterface.createTable('student_message_templates', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        title: { type: DataTypes.STRING(180), allowNull: false },
        key: { type: DataTypes.STRING(80), allowNull: false, unique: true },
        category: { type: DataTypes.STRING(40), allowNull: false },
        channel: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'whatsapp' },
        body: { type: DataTypes.TEXT, allowNull: false },
        buttons: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        automation_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('student_message_templates', ['category']);
    }
    for (const [title, key, category, body, buttons] of templates) {
      await queryInterface.bulkInsert('student_message_templates', [{
        title, key, category, channel: 'whatsapp', body,
        buttons: JSON.stringify(buttons), is_active: true, automation_enabled: true,
        created_at: new Date(), updated_at: new Date()
      }]).catch(() => null);
    }

    if (!await describe(queryInterface, 'student_automation_dispatches')) {
      await queryInterface.createTable('student_automation_dispatches', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        template_key: { type: DataTypes.STRING(80), allowNull: false },
        student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        event_key: { type: DataTypes.STRING(180), allowNull: false },
        event_date: { type: DataTypes.DATEONLY, allowNull: true },
        dedupe_key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
        queue_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'queued' },
        payload: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('student_automation_dispatches', ['student_id', 'template_key']);
    }

    await addColumn(queryInterface, 'lms_lessons', 'zoom_meeting_id', { type: DataTypes.STRING(100), allowNull: true });
    await addColumn(queryInterface, 'lms_lessons', 'zoom_password', { type: DataTypes.STRING(100), allowNull: true });
    await addColumn(queryInterface, 'lms_lessons', 'join_button_label', { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Join Class' });
    await addColumn(queryInterface, 'lms_lessons', 'allow_join_before_minutes', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 30 });
    await addColumn(queryInterface, 'lms_lessons', 'allow_join_after_minutes', { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 150 });

    if (!await describe(queryInterface, 'lms_live_class_joins')) {
      await queryInterface.createTable('lms_live_class_joins', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        lesson_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        joined_at: { type: DataTypes.DATE, allowNull: true },
        ip_address: { type: DataTypes.STRING(64), allowNull: true },
        user_agent: { type: DataTypes.TEXT, allowNull: true },
        access_status: { type: DataTypes.STRING(20), allowNull: false },
        blocked_reason: { type: DataTypes.STRING(120), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('lms_live_class_joins', ['student_id', 'lesson_id']);
    }
    await addColumn(queryInterface, 'attendance_records', 'lesson_id', { type: DataTypes.BIGINT.UNSIGNED, allowNull: true });
    await addColumn(queryInterface, 'attendance_records', 'source', { type: DataTypes.STRING(40), allowNull: true });
    await addColumn(queryInterface, 'attendance_records', 'marked_at', { type: DataTypes.DATE, allowNull: true });
  },
  async down() {
    // Data-retaining migration.
  }
};
