module.exports = (sequelize, D) => sequelize.define('AiProvider', {
  id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
  name: { type: D.STRING(120), allowNull: false }, providerType: { type: D.STRING(40), allowNull: false },
  enabled: { type: D.BOOLEAN, allowNull: false, defaultValue: true }, apiBaseUrl: D.STRING(500),
  model: { type: D.STRING(120), allowNull: false }, encryptedApiKey: D.TEXT, keyIv: D.STRING(64), keyTag: D.STRING(64),
  organizationId: D.STRING(180), projectId: D.STRING(180),
  defaultTemperature: { type: D.DECIMAL(4, 2), allowNull: false, defaultValue: 0.3 },
  maxOutputTokens: { type: D.INTEGER, allowNull: false, defaultValue: 1024 },
  requestTimeout: { type: D.INTEGER, allowNull: false, defaultValue: 30000 },
  retryCount: { type: D.INTEGER, allowNull: false, defaultValue: 2 }, dailyBudget: D.DECIMAL(12, 2),
  isDefault: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
  lastTestStatus: D.STRING(30), lastTestAt: D.DATE, createdBy: D.BIGINT, updatedBy: D.BIGINT
}, { tableName: 'ai_providers', timestamps: true, underscored: true,
  defaultScope: { attributes: { exclude: ['encryptedApiKey', 'keyIv', 'keyTag'] } } });
