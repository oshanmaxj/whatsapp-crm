module.exports = (sequelize, DataTypes) => {
  const Flow = sequelize.define('Flow', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'whatsapp' },
    // Additive multi-channel scope: when set (non-empty array), this is the
    // authoritative list of channels the flow is enabled for and `channel`
    // above is kept only for display/legacy readers. NULL/empty here means
    // "use the legacy single `channel` value" — every flow created before
    // this column existed has channels = NULL and behaves exactly as before.
    channels: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
    facebookPageId: { type: DataTypes.BIGINT, allowNull: true, field: 'facebook_page_id' },
    departmentId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'draft', validate: { isIn: [['draft', 'published', 'inactive']] } },
    triggerType: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'keyword' },
    triggerKeywords: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    triggerConfig: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    whatsappPhoneNumberId: { type: DataTypes.STRING(100), allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'flows',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['status'] }, { fields: ['trigger_type'] }]
  });

  Flow.associate = (models) => {
    Flow.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Flow.belongsTo(models.Role, { foreignKey: 'department_id', as: 'department' });
    Flow.hasMany(models.FlowNode, { foreignKey: 'flow_id', as: 'nodes' });
    Flow.hasMany(models.FlowConnection, { foreignKey: 'flow_id', as: 'connections' });
    Flow.hasMany(models.FlowRun, { foreignKey: 'flow_id', as: 'runs' });
    Flow.belongsTo(models.FacebookPage, { foreignKey: 'facebook_page_id', as: 'facebookPage' });
  };

  return Flow;
};
