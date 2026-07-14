module.exports = (sequelize, DataTypes) => sequelize.define('LeadActivity', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true, field: 'id' },
  actorUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, field: 'actor_user_id' },
  leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, field: 'lead_id' },
  action: { type: DataTypes.STRING(80), allowNull: false, field: 'action' },
  oldValue: { type: DataTypes.JSON, allowNull: true, field: 'old_value' },
  newValue: { type: DataTypes.JSON, allowNull: true, field: 'new_value' },
  note: { type: DataTypes.TEXT, allowNull: true, field: 'note' },
  createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' }
}, {
  tableName: 'lead_activities',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: false,
  underscored: true
});
