module.exports = (sequelize, DataTypes) => {
  const FacebookPage = sequelize.define('FacebookPage', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    pageId: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    pageAccessTokenEncrypted: { type: DataTypes.TEXT, allowNull: false },
    appId: { type: DataTypes.STRING(64), allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    webhookSubscribed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    sendEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdBy: { type: DataTypes.BIGINT, allowNull: true }
  }, {
    tableName: 'facebook_pages',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['page_id'] },
      { fields: ['active'] }
    ]
  });

  FacebookPage.associate = (models) => {
    FacebookPage.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return FacebookPage;
};
