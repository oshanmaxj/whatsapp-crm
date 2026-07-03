module.exports = (sequelize, DataTypes) => {
  const FlowNode = sequelize.define('FlowNode', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    flowId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    nodeKey: { type: DataTypes.STRING(120), allowNull: false },
    nodeType: { type: DataTypes.STRING(80), allowNull: false },
    label: { type: DataTypes.STRING(180), allowNull: false },
    positionX: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    positionY: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    configJson: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    stats: {
      type: DataTypes.JSON, allowNull: false,
      defaultValue: { sent: 0, delivered: 0, read: 0, subscribers: 0, errors: 0 }
    }
  }, {
    tableName: 'flow_nodes',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['flow_id', 'node_key'] }, { fields: ['node_type'] }]
  });

  FlowNode.associate = (models) => {
    FlowNode.belongsTo(models.Flow, { foreignKey: 'flow_id', as: 'flow' });
  };

  return FlowNode;
};
