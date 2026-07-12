module.exports = (sequelize, DataTypes) => sequelize.define('ConversationAssignmentHistory', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  conversationId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  previousUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  newUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  changedByUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  reason: { type: DataTypes.TEXT, allowNull: true },
  action: { type: DataTypes.ENUM('CLAIMED', 'ASSIGNED', 'REASSIGNED', 'UNASSIGNED'), allowNull: false }
}, { tableName: 'conversation_assignment_history', timestamps: true, updatedAt: false, underscored: true });
