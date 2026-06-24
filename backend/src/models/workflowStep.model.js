module.exports = (sequelize, DataTypes) => {
  const WorkflowStep = sequelize.define('WorkflowStep', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    workflowId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    sortOrder: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    actionType: {
      type: DataTypes.ENUM(
        'send_whatsapp_message',
        'add_tag_label',
        'assign_agent',
        'change_lead_status',
        'create_follow_up',
        'add_internal_note',
        'send_campaign_template'
      ),
      allowNull: false
    },
    config: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'workflow_steps',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['workflow_id'] }, { fields: ['action_type'] }]
  });

  WorkflowStep.associate = (models) => {
    WorkflowStep.belongsTo(models.Workflow, { foreignKey: 'workflow_id', as: 'workflow' });
  };

  return WorkflowStep;
};
