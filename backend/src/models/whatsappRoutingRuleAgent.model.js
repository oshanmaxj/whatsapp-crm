module.exports = (sequelize, DataTypes) => sequelize.define('WhatsAppRoutingRuleAgent', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  routingRuleId: { type: DataTypes.BIGINT, allowNull: false },
  agentId: { type: DataTypes.BIGINT, allowNull: false },
  weight: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  maxOpenChats: { type: DataTypes.INTEGER, allowNull: true },
  isEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { tableName: 'whatsapp_routing_rule_agents', timestamps: true, underscored: true,
  indexes: [{ unique: true, fields: ['routing_rule_id', 'agent_id'] }] });
