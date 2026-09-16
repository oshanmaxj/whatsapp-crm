module.exports = (sequelize, DataTypes) => {
  const FacebookComment = sequelize.define('FacebookComment', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    facebookPageId: { type: DataTypes.BIGINT, allowNull: false, field: 'facebook_page_id' },
    metaCommentId: { type: DataTypes.STRING(128), allowNull: false, unique: true, field: 'meta_comment_id' },
    metaPostId: { type: DataTypes.STRING(128), allowNull: false, field: 'meta_post_id' },
    parentCommentId: { type: DataTypes.STRING(128), allowNull: true, field: 'parent_comment_id' },
    facebookPsid: { type: DataTypes.STRING(64), allowNull: true, field: 'facebook_psid' },
    contactId: { type: DataTypes.BIGINT, allowNull: true, field: 'contact_id' },
    leadId: { type: DataTypes.BIGINT, allowNull: true, field: 'lead_id' },
    assignedUserId: { type: DataTypes.BIGINT, allowNull: true, field: 'assigned_user_id' },
    message: { type: DataTypes.TEXT, allowNull: true },
    createdTime: { type: DataTypes.DATE, allowNull: false, field: 'created_time' },
    hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    replied: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'facebook_comments',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['meta_comment_id'] },
      { fields: ['facebook_page_id'], name: 'facebook_comments_page_idx' },
      { fields: ['meta_post_id'], name: 'facebook_comments_post_idx' },
      { fields: ['contact_id'], name: 'facebook_comments_contact_idx' },
      { fields: ['lead_id'], name: 'facebook_comments_lead_idx' },
      { fields: ['assigned_user_id'], name: 'facebook_comments_assigned_user_idx' }
    ]
  });

  FacebookComment.associate = (models) => {
    FacebookComment.belongsTo(models.FacebookPage, { foreignKey: 'facebook_page_id', as: 'facebookPage' });
    FacebookComment.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    FacebookComment.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    FacebookComment.belongsTo(models.User, { foreignKey: 'assigned_user_id', as: 'assignedUser' });
  };

  return FacebookComment;
};
