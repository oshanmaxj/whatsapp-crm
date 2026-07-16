module.exports = (sequelize, DataTypes) => sequelize.define('LeadActivity', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true, field: 'id' },
  actorUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, field: 'actor_user_id' },
  leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, field: 'lead_id' },
  activityType: { type: DataTypes.STRING(80), allowNull: false, field: 'activity_type' },
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
  underscored: true,
  hooks: {
    beforeValidate(activity) {
      activity.activityType = activity.activityType || activity.action;
      activity.action = activity.action || activity.activityType;
      if (!activity.activityType) {
        throw Object.assign(new Error('Lead activity type is required.'), { code: 'LEAD_ACTIVITY_TYPE_REQUIRED' });
      }
    }
  }
});
