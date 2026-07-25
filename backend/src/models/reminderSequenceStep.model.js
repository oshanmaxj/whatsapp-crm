module.exports = (sequelize, D) => sequelize.define('ReminderSequenceStep', {
  id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
  sequenceId: { type: D.BIGINT, allowNull: false },
  stepNumber: { type: D.INTEGER, allowNull: false },
  delayValue: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
  delayUnit: { type: D.STRING(15), allowNull: false, defaultValue: 'minutes' },
  messageMode: { type: D.STRING(30), allowNull: false, defaultValue: 'automatic' },
  sessionMessageType: { type: D.STRING(30), allowNull: false, defaultValue: 'text' },
  body: D.TEXT, mediaId: D.BIGINT, flowId: D.BIGINT, templateId: D.BIGINT,
  templateLanguage: D.STRING(20), templateParameterMappings: { type: D.JSONB, allowNull: false, defaultValue: {} },
  buttonConfiguration: { type: D.JSONB, allowNull: false, defaultValue: {} },
  continueOnFailure: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
  enabled: { type: D.BOOLEAN, allowNull: false, defaultValue: true }
}, { tableName: 'reminder_sequence_steps', timestamps: true, underscored: true,
  indexes: [{ unique: true, fields: ['sequence_id', 'step_number'] }] });
