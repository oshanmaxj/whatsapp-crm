module.exports = (sequelize, DataTypes) => sequelize.define('WhatsAppRoutingUnassigned', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  whatsappAccountId: { type: DataTypes.BIGINT, allowNull: false },
  routingRuleId: { type: DataTypes.BIGINT, allowNull: true },
  conversationId: { type: DataTypes.BIGINT, allowNull: false },
  contactId: { type: DataTypes.BIGINT, allowNull: false },
  leadId: { type: DataTypes.BIGINT, allowNull: true },
  sourceMessageId: { type: DataTypes.STRING(255), allowNull: true },
  exclusionReasons: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'open' },
  resolvedAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'whatsapp_routing_unassigned_queue', timestamps: true, underscored: true });
