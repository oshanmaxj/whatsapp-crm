module.exports = (sequelize, DataTypes) => {
  const Flow = sequelize.define('Flow', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
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
  };

  return Flow;
};
