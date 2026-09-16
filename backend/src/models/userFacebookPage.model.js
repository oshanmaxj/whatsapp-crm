module.exports = (sequelize, DataTypes) => sequelize.define('UserFacebookPage', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
  facebookPageId: { type: DataTypes.BIGINT, allowNull: false, field: 'facebook_page_id' }
}, {
  tableName: 'user_facebook_pages',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['user_id', 'facebook_page_id'], name: 'user_facebook_pages_user_page_uq' },
    { fields: ['user_id'], name: 'user_facebook_pages_user_idx' },
    { fields: ['facebook_page_id'], name: 'user_facebook_pages_page_idx' }
  ]
});
