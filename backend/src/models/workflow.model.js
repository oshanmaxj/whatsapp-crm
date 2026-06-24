module.exports = (sequelize, DataTypes) => {
  const Workflow = sequelize.define('Workflow', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    triggerType: {
      type: DataTypes.ENUM(
        'new_whatsapp_message',
        'new_contact_created',
        'new_lead_created',
        'lead_status_changed',
        'campaign_replied',
        'appointment_booked',
        'follow_up_due'
      ),
      allowNull: false
    },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    conditions: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    lastRunAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'workflows',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['trigger_type'] }, { fields: ['enabled'] }]
  });

  Workflow.associate = (models) => {
    Workflow.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return Workflow;
};
