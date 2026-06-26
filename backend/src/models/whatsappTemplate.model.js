module.exports = (sequelize, DataTypes) => {
  const WhatsAppTemplate = sequelize.define('WhatsAppTemplate', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    metaTemplateId: { type: DataTypes.STRING(180), allowNull: true },
    category: { type: DataTypes.ENUM('UTILITY', 'MARKETING', 'AUTHENTICATION'), allowNull: false, defaultValue: 'UTILITY' },
    language: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'en_US' },
    headerType: { type: DataTypes.ENUM('NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'), allowNull: false, defaultValue: 'NONE' },
    headerContent: { type: DataTypes.TEXT, allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: false },
    footer: { type: DataTypes.TEXT, allowNull: true },
    buttons: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    variables: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    status: { type: DataTypes.ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'DISABLED'), allowNull: false, defaultValue: 'DRAFT' },
    qualityRating: { type: DataTypes.ENUM('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'), allowNull: false, defaultValue: 'UNKNOWN' },
    lastSyncedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'whatsapp_templates',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['name'] },
      { fields: ['meta_template_id'] },
      { fields: ['category'] },
      { fields: ['language'] },
      { fields: ['status'] },
      { fields: ['quality_rating'] }
    ]
  });

  return WhatsAppTemplate;
};
