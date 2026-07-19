module.exports = (sequelize, DataTypes) => sequelize.define('ContactListMember', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  contactListId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  sourceFlowRunId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
}, { tableName: 'contact_list_members', timestamps: true, underscored: true, indexes: [{ unique: true, fields: ['contact_list_id', 'contact_id'] }] });
