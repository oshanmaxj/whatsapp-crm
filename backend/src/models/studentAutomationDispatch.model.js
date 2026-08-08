module.exports = (sequelize, DataTypes) => {
  const StudentAutomationDispatch = sequelize.define('StudentAutomationDispatch', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    templateKey: { type: DataTypes.STRING(80), allowNull: false },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    eventKey: { type: DataTypes.STRING(180), allowNull: false },
    eventDate: { type: DataTypes.DATEONLY, allowNull: true },
    dedupeKey: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    queueId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    enrollmentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    whatsappMessageId: { type: DataTypes.STRING(255), allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
    lastErrorMessage: { type: DataTypes.TEXT, allowNull: true },
    acceptedAt: { type: DataTypes.DATE, allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true },
    failedAt: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'queued' },
    payload: { type: DataTypes.JSON, allowNull: false, defaultValue: {} }
  }, { tableName: 'student_automation_dispatches', timestamps: true, underscored: true });
  return StudentAutomationDispatch;
};
