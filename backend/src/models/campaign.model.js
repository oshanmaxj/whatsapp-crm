module.exports = (sequelize, DataTypes) => {
  const Campaign = sequelize.define('Campaign', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM('Draft', 'Scheduled', 'Processing', 'Completed', 'Failed', 'Cancelled'),
      allowNull: false,
      defaultValue: 'Draft'
    },
    audienceType: {
      type: DataTypes.ENUM('contacts', 'leads', 'mixed'),
      allowNull: false,
      defaultValue: 'contacts'
    },
    filters: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    templateId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    whatsappTemplateId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    templateName: { type: DataTypes.STRING(150), allowNull: true },
    messageBody: { type: DataTypes.TEXT, allowNull: false },
    variables: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    mediaId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    scheduledAt: { type: DataTypes.DATE, allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'campaigns',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['status'] }, { fields: ['scheduled_at'] }]
  });

  Campaign.associate = (models) => {
    Campaign.belongsTo(models.MessageTemplate, { foreignKey: 'template_id', as: 'template' });
    Campaign.belongsTo(models.WhatsAppTemplate, { foreignKey: 'whatsapp_template_id', as: 'whatsappTemplate' });
    Campaign.belongsTo(models.Media, { foreignKey: 'media_id', as: 'media' });
    Campaign.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return Campaign;
};
