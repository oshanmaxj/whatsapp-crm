async function addIndex(queryInterface, table, fields, name, transaction) {
  const indexes = await queryInterface.showIndex(table, { transaction }).catch(() => []);
  if (!indexes.some((index) => index.name === name)) await queryInterface.addIndex(table, fields, { name, transaction });
}

module.exports = {
  async up(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await addIndex(queryInterface, 'students', ['student_no'], 'students_student_no_search_idx', transaction);
      await addIndex(queryInterface, 'students', ['phone'], 'students_phone_search_idx', transaction);
      await addIndex(queryInterface, 'students', ['email'], 'students_email_search_idx', transaction);
      await addIndex(queryInterface, 'courses', ['code'], 'courses_code_search_idx', transaction);
      await addIndex(queryInterface, 'batches', ['code'], 'batches_code_search_idx', transaction);
      await addIndex(queryInterface, 'batches', ['course_id', 'status'], 'batches_course_status_search_idx', transaction);
      await addIndex(queryInterface, 'student_fees', ['course_id'], 'student_fees_course_search_idx', transaction);
      await addIndex(queryInterface, 'student_fees', ['batch_id'], 'student_fees_batch_search_idx', transaction);
      await addIndex(queryInterface, 'student_fees', ['status', 'created_at'], 'student_fees_status_created_search_idx', transaction);
      await addIndex(queryInterface, 'lms_topics', ['course_id', 'status', 'sort_order'], 'lms_topics_course_status_order_idx', transaction);
      await addIndex(queryInterface, 'lms_lessons', ['topic_id', 'status', 'sort_order'], 'lms_lessons_topic_status_order_idx', transaction);

      if (queryInterface.sequelize.getDialect() === 'postgres') {
        await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm', { transaction });
        const expressions = [
          ['students_name_trgm_idx', 'students', 'lower(name)'],
          ['courses_name_trgm_idx', 'courses', 'lower(name)'],
          ['batches_name_trgm_idx', 'batches', 'lower(name)']
        ];
        for (const [name, table, expression] of expressions) {
          await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} USING gin (${expression} gin_trgm_ops)`, { transaction });
        }
      }
    });
  },
  async down(queryInterface) {
    const names = [
      'students_student_no_search_idx', 'students_phone_search_idx', 'students_email_search_idx', 'courses_code_search_idx',
      'batches_code_search_idx', 'batches_course_status_search_idx', 'student_fees_course_search_idx', 'student_fees_batch_search_idx',
      'student_fees_status_created_search_idx', 'lms_topics_course_status_order_idx', 'lms_lessons_topic_status_order_idx',
      'students_name_trgm_idx', 'courses_name_trgm_idx', 'batches_name_trgm_idx'
    ];
    for (const name of names) await queryInterface.removeIndex(name.includes('courses_') ? 'courses' : name.includes('batches_') ? 'batches' : name.includes('student_fees_') ? 'student_fees' : name.includes('lms_topics_') ? 'lms_topics' : name.includes('lms_lessons_') ? 'lms_lessons' : 'students', name).catch(() => null);
  }
};
