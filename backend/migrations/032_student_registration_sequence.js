module.exports = {
  async up(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        'CREATE SEQUENCE IF NOT EXISTS student_registration_number_seq START WITH 10852 INCREMENT BY 1 MINVALUE 1',
        { transaction }
      );
      await queryInterface.sequelize.query(`
        WITH formatted AS (
          SELECT COALESCE(MAX(substring(student_no FROM '^STU-([0-9]{6})$')::BIGINT), 10851) AS maximum
          FROM students
        ), sequence_state AS (
          SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS next_value
          FROM student_registration_number_seq
        )
        SELECT setval(
          'student_registration_number_seq',
          GREATEST(10852, formatted.maximum + 1, sequence_state.next_value),
          false
        )
        FROM formatted, sequence_state
      `, { transaction });
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS students_student_no_unique ON students (student_no)',
        { transaction }
      );
    });
  },
  async down() {}
};
