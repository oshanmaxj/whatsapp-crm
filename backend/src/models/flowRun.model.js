module.exports = (sequelize, DataTypes) => {
  const FlowRun = sequelize.define('FlowRun', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    flowId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    conversationId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    currentNodeKey: { type: DataTypes.STRING(120), allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'running', validate: { isIn: [['running', 'completed', 'failed', 'waiting', 'simulated']] } },
    contextJson: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    waitingForReply: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    waitingNodeKey: { type: DataTypes.STRING(120), allowNull: true },
    lastWhatsappMessageId: { type: DataTypes.STRING(255), allowNull: true },
    errorMessage: { type: DataTypes.TEXT, allowNull: true },
    failedNodeId: { type: DataTypes.STRING(120), allowNull: true },
    failedNodeType: { type: DataTypes.STRING(120), allowNull: true },
    whatsappApiResponse: { type: DataTypes.JSON, allowNull: true },
    payloadSent: { type: DataTypes.JSON, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    completedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'flow_runs',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['flow_id'] }, { fields: ['contact_id'] }, { fields: ['lead_id'] }, { fields: ['status'] }]
  });

  FlowRun.associate = (models) => {
    FlowRun.belongsTo(models.Flow, { foreignKey: 'flow_id', as: 'flow' });
    FlowRun.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    FlowRun.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    FlowRun.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    FlowRun.hasMany(models.FlowRunLog, { foreignKey: 'flow_run_id', as: 'logs' });
  };

  return FlowRun;
};
