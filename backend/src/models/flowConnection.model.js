module.exports = (sequelize, DataTypes) => {
  const FlowConnection = sequelize.define('FlowConnection', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    flowId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    sourceNodeKey: { type: DataTypes.STRING(120), allowNull: false },
    sourceHandle: { type: DataTypes.STRING(120), allowNull: true },
    targetNodeKey: { type: DataTypes.STRING(120), allowNull: false },
    targetHandle: { type: DataTypes.STRING(120), allowNull: true },
    conditionLabel: { type: DataTypes.STRING(180), allowNull: true },
    condition: { type: DataTypes.JSON, allowNull: false, defaultValue: {} }
  }, {
    tableName: 'flow_connections',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['flow_id'] }, { fields: ['source_node_key'] }, { fields: ['target_node_key'] }]
  });

  FlowConnection.associate = (models) => {
    FlowConnection.belongsTo(models.Flow, { foreignKey: 'flow_id', as: 'flow' });
  };

  return FlowConnection;
};
