async function tableExists(queryInterface, tableName) {
  return Boolean(await queryInterface.describeTable(tableName).catch(() => null));
}

async function addColumn(queryInterface, tableName, columnName, definition) {
  const description = await queryInterface.describeTable(tableName).catch(() => null);
  if (description && !description[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function addIndex(queryInterface, tableName, fields, options) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(tableName, fields, options);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    if (!await tableExists(queryInterface, 'student_enrollments')) {
      await queryInterface.createTable('student_enrollments', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        batch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        enrollment_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active' },
        enrolled_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        completed_at: { type: DataTypes.DATE, allowNull: true },
        created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    }

    await addIndex(queryInterface, 'student_enrollments', ['student_id'], { name: 'student_enrollments_student_idx' });
    await addIndex(queryInterface, 'student_enrollments', ['course_id'], { name: 'student_enrollments_course_idx' });
    await addIndex(queryInterface, 'student_enrollments', ['batch_id'], { name: 'student_enrollments_batch_idx' });
    await addIndex(queryInterface, 'student_enrollments', ['enrollment_status'], { name: 'student_enrollments_status_idx' });
    await addIndex(queryInterface, 'student_enrollments', ['student_id', 'course_id', 'batch_id'], { name: 'student_enrollments_student_course_batch_idx' });
    await addIndex(queryInterface, 'student_enrollments', ['student_id', 'enrollment_status'], { name: 'student_enrollments_student_status_idx' });
    await addIndex(queryInterface, 'student_enrollments', ['course_id', 'batch_id'], { name: 'student_enrollments_course_batch_idx' });

    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS student_enrollments_active_unique
        ON student_enrollments (student_id, course_id, COALESCE(batch_id, 0))
        WHERE enrollment_status = 'active'
      `);
    }

    await queryInterface.sequelize.query(`
      INSERT INTO student_enrollments
        (student_id, course_id, batch_id, enrollment_status, enrolled_at, created_at, updated_at)
      SELECT s.id, s.course_id, s.batch_id,
        CASE WHEN s.status = 'completed' THEN 'completed'
             WHEN s.status = 'suspended' THEN 'suspended'
             WHEN s.status = 'dropped' THEN 'cancelled'
             ELSE 'active' END,
        COALESCE(s.enrolled_at, s.created_at, CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM students s
      WHERE s.course_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM student_enrollments e
          WHERE e.student_id = s.id
            AND e.course_id = s.course_id
            AND ((e.batch_id = s.batch_id) OR (e.batch_id IS NULL AND s.batch_id IS NULL))
        )
    `);

    await addColumn(queryInterface, 'student_fees', 'enrollment_id', {
      type: DataTypes.BIGINT.UNSIGNED, allowNull: true
    });
    await addIndex(queryInterface, 'student_fees', ['enrollment_id'], { name: 'student_fees_enrollment_idx' });
    await queryInterface.sequelize.query(`
      UPDATE student_fees sf
      SET enrollment_id = (
        SELECT e.id FROM student_enrollments e
        WHERE e.student_id = sf.student_id
          AND e.course_id = sf.course_id
          AND ((e.batch_id = sf.batch_id) OR (e.batch_id IS NULL AND sf.batch_id IS NULL))
        ORDER BY CASE WHEN e.enrollment_status = 'active' THEN 0 ELSE 1 END, e.enrolled_at DESC
        LIMIT 1
      )
      WHERE sf.enrollment_id IS NULL AND sf.course_id IS NOT NULL
    `);

    await addColumn(queryInterface, 'attendance_records', 'enrollment_id', {
      type: DataTypes.BIGINT.UNSIGNED, allowNull: true
    });
    await addColumn(queryInterface, 'attendance_records', 'joined_at', {
      type: DataTypes.DATE, allowNull: true
    });
    await addIndex(queryInterface, 'attendance_records', ['enrollment_id'], { name: 'attendance_records_enrollment_idx' });
    await addIndex(queryInterface, 'attendance_records', ['student_id', 'lesson_id'], {
      name: 'attendance_records_student_lesson_unique',
      unique: true
    });

    await addColumn(queryInterface, 'certificates', 'enrollment_id', {
      type: DataTypes.BIGINT.UNSIGNED, allowNull: true
    });
    await addIndex(queryInterface, 'certificates', ['enrollment_id'], { name: 'certificates_enrollment_idx' });
    await addIndex(queryInterface, 'certificates', ['student_id', 'enrollment_id'], {
      name: 'certificates_student_enrollment_idx'
    });

    await addColumn(queryInterface, 'courses', 'whatsapp_group_link', {
      type: DataTypes.STRING(500), allowNull: true
    });
    await addColumn(queryInterface, 'courses', 'whatsapp_group_name', {
      type: DataTypes.STRING(180), allowNull: true
    });
    await addColumn(queryInterface, 'batches', 'whatsapp_group_link', {
      type: DataTypes.STRING(500), allowNull: true
    });
    await addColumn(queryInterface, 'batches', 'whatsapp_group_name', {
      type: DataTypes.STRING(180), allowNull: true
    });

    if (await tableExists(queryInterface, 'lms_lesson_materials')) {
      await addColumn(queryInterface, 'lms_lesson_materials', 'course_id', {
        type: DataTypes.BIGINT.UNSIGNED, allowNull: true
      });
      await addColumn(queryInterface, 'lms_lesson_materials', 'batch_id', {
        type: DataTypes.BIGINT.UNSIGNED, allowNull: true
      });
      await addColumn(queryInterface, 'lms_lesson_materials', 'material_type', {
        type: DataTypes.STRING(40), allowNull: false, defaultValue: 'External Link'
      });
      await addColumn(queryInterface, 'lms_lesson_materials', 'description', {
        type: DataTypes.TEXT, allowNull: true
      });
      await addColumn(queryInterface, 'lms_lesson_materials', 'visibility', {
        type: DataTypes.STRING(30), allowNull: false, defaultValue: 'all_students'
      });
      await addColumn(queryInterface, 'lms_lesson_materials', 'status', {
        type: DataTypes.STRING(20), allowNull: false, defaultValue: 'published'
      });
      await addIndex(queryInterface, 'lms_lesson_materials', ['course_id', 'batch_id', 'status'], {
        name: 'lms_materials_access_idx'
      });
      if (queryInterface.sequelize.getDialect() === 'postgres') {
        await queryInterface.sequelize.query(`
          UPDATE lms_lesson_materials m
          SET course_id = l.course_id, batch_id = l.batch_id
          FROM lms_lessons l
          WHERE m.lesson_id = l.id AND m.course_id IS NULL
        `);
      } else {
        await queryInterface.sequelize.query(`
          UPDATE lms_lesson_materials m
          JOIN lms_lessons l ON m.lesson_id = l.id
          SET m.course_id = l.course_id, m.batch_id = l.batch_id
          WHERE m.course_id IS NULL
        `);
      }
    }

    if (!await tableExists(queryInterface, 'lms_lesson_comments')) {
      await queryInterface.createTable('lms_lesson_comments', {
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        lesson_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        student_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        comment: { type: DataTypes.TEXT, allowNull: false },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await addIndex(queryInterface, 'lms_lesson_comments', ['lesson_id', 'created_at'], {
        name: 'lms_lesson_comments_lesson_idx'
      });
    }

    if (await tableExists(queryInterface, 'student_message_templates')) {
      await queryInterface.bulkInsert('student_message_templates', [{
        title: 'Enrollment Welcome',
        key: 'enrollment_welcome',
        category: 'Student',
        channel: 'whatsapp',
        body: [
          'Welcome {{student_name}},',
          '',
          'You are enrolled in {{course_name}} - {{batch_name}}.',
          '',
          'LMS Login: {{portal_url}}',
          'Username: {{portal_username}}',
          'Password: {{portal_password}}',
          'WhatsApp Group: {{whatsapp_group_link}}'
        ].join('\n'),
        buttons: JSON.stringify([{ type: 'url', title: 'Open LMS', url: '{{portal_url}}' }]),
        is_active: true,
        automation_enabled: true,
        created_at: new Date(),
        updated_at: new Date()
      }]).catch(() => null);
    }

    if (await tableExists(queryInterface, 'lms_lessons')) {
      await queryInterface.sequelize.query(`
        UPDATE lms_lessons
        SET join_button_label = 'Join Live Class'
        WHERE join_button_label IS NULL OR join_button_label = 'Join Class'
      `);
    }
  },
  async down() {
    // Enrollment history is intentionally retained.
  }
};
