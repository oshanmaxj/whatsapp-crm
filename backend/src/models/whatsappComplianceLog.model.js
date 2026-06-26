module.exports = (sequelize, DataTypes) => {
  const WhatsAppComplianceLog = sequelize.define('WhatsAppComplianceLog', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    messageType: { type: DataTypes.ENUM('free_form', 'template'), allowNull: false },
    windowStatus: { type: DataTypes.ENUM('open', 'closed', 'unknown'), allowNull: false, defaultValue: 'unknown' },
    templateId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    allowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    reason: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'whatsapp_compliance_logs',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [
      { fields: ['contact_id'] },
      { fields: ['message_type'] },
      { fields: ['window_status'] },
      { fields: ['template_id'] },
      { fields: ['allowed'] },
      { fields: ['created_at'] }
    ]
  });

  WhatsAppComplianceLog.associate = (models) => {
    WhatsAppComplianceLog.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    WhatsAppComplianceLog.belongsTo(models.WhatsAppTemplate, { foreignKey: 'template_id', as: 'template' });
  };

  return WhatsAppComplianceLog;
};
