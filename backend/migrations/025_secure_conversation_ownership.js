const permissions = [
  'conversation.claim_unassigned', 'conversation.view_assigned_others', 'conversation.reassign',
  'conversation.unassign', 'conversation.override_owner', 'payment.record',
  'payment.override_credit_owner', 'student.convert', 'student.override_conversion_owner'
];
async function add(queryInterface, table, column, definition) {
  const current = await queryInterface.describeTable(table);
  if (!current[column]) await queryInterface.addColumn(table, column, definition);
}
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('conversation_assignment_history', {
      id: { type: Sequelize.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      conversation_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, references: { model: 'conversations', key: 'id' }, onDelete: 'CASCADE' },
      previous_user_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true }, new_user_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: true },
      changed_by_user_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false }, reason: { type: Sequelize.TEXT, allowNull: true },
      action: { type: Sequelize.ENUM('CLAIMED', 'ASSIGNED', 'REASSIGNED', 'UNASSIGNED'), allowNull: false }, created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    }).catch(() => {});
    await queryInterface.addIndex('conversation_assignment_history', ['conversation_id', 'created_at'], { name: 'conversation_assignment_history_conversation_created_idx' }).catch(() => {});
    const userId = { type: Sequelize.BIGINT.UNSIGNED, allowNull: true };
    await add(queryInterface, 'students', 'converted_by_user_id', userId); await add(queryInterface, 'students', 'credited_to_user_id', userId);
    await add(queryInterface, 'students', 'converted_at', { type: Sequelize.DATE, allowNull: true }); await add(queryInterface, 'students', 'conversion_override_reason', { type: Sequelize.TEXT, allowNull: true }); await add(queryInterface, 'students', 'conversion_overridden_by_user_id', userId);
    for (const column of ['recorded_by_user_id','credited_to_user_id','conversation_owner_user_id','overridden_by_user_id']) await add(queryInterface, 'fee_installments', column, userId);
    await add(queryInterface, 'fee_installments', 'recorded_at', { type: Sequelize.DATE, allowNull: true }); await add(queryInterface, 'fee_installments', 'attribution_source', { type: Sequelize.STRING(40), allowNull: true }); await add(queryInterface, 'fee_installments', 'override_reason', { type: Sequelize.TEXT, allowNull: true });
    // Permission rows and recommended role grants are seeded by user.service so this remains database-dialect neutral.
  },
  async down() {}
};
