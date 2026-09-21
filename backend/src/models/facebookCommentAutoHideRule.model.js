module.exports = (sequelize, DataTypes) => {
  const FacebookCommentAutoHideRule = sequelize.define('FacebookCommentAutoHideRule', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    keyword: { type: DataTypes.STRING(255), allowNull: false },
    matchType: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'contains', field: 'match_type' },
    caseSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'case_sensitive' },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // NULL = applies to every Facebook Page the system manages.
    facebookPageId: { type: DataTypes.BIGINT, allowNull: true, field: 'facebook_page_id' },
    createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' }
  }, {
    tableName: 'facebook_comment_auto_hide_rules',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['facebook_page_id'], name: 'facebook_comment_auto_hide_rules_page_idx' },
      { fields: ['enabled'], name: 'facebook_comment_auto_hide_rules_enabled_idx' }
    ]
  });

  FacebookCommentAutoHideRule.associate = (models) => {
    FacebookCommentAutoHideRule.belongsTo(models.FacebookPage, { foreignKey: 'facebook_page_id', as: 'facebookPage' });
    FacebookCommentAutoHideRule.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return FacebookCommentAutoHideRule;
};
