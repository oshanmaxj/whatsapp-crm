module.exports = (sequelize, DataTypes) => {
  const FacebookContact = sequelize.define('FacebookContact', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    facebookPageId: { type: DataTypes.BIGINT, allowNull: false, field: 'facebook_page_id' },
    facebookPsid: { type: DataTypes.STRING(64), allowNull: false, field: 'facebook_psid' },
    contactId: { type: DataTypes.BIGINT, allowNull: true, field: 'contact_id' },
    displayName: { type: DataTypes.STRING(255), allowNull: true, field: 'display_name' },
    profilePictureUrl: { type: DataTypes.STRING(1024), allowNull: true, field: 'profile_picture_url' }
  }, {
    tableName: 'facebook_contacts',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['facebook_page_id', 'facebook_psid'], name: 'facebook_contacts_page_psid_uq' },
      { fields: ['contact_id'], name: 'facebook_contacts_contact_idx' }
    ]
  });

  FacebookContact.associate = (models) => {
    FacebookContact.belongsTo(models.FacebookPage, { foreignKey: 'facebook_page_id', as: 'facebookPage' });
    FacebookContact.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
  };

  return FacebookContact;
};
