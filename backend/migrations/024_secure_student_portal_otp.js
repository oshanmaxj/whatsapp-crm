async function safeAddColumn(queryInterface, table, column, definition) {
  const description = await queryInterface.describeTable(table);
  if (!description[column]) await queryInterface.addColumn(table, column, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await safeAddColumn(queryInterface, 'student_portal_sessions', 'otp_used_at', { type: Sequelize.DATE, allowNull: true });
    await safeAddColumn(queryInterface, 'student_portal_sessions', 'otp_attempts', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.addIndex('student_portal_sessions', ['student_id', 'created_at'], { name: 'student_portal_sessions_student_created_idx' }).catch(() => {});
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('student_portal_sessions', 'student_portal_sessions_student_created_idx').catch(() => {});
    await queryInterface.removeColumn('student_portal_sessions', 'otp_attempts').catch(() => {});
    await queryInterface.removeColumn('student_portal_sessions', 'otp_used_at').catch(() => {});
  }
};
