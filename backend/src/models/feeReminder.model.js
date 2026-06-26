module.exports = (sequelize, DataTypes) => {
  const FeeReminder = sequelize.define('FeeReminder', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    studentFeeId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    installmentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    reminderType: {
      type: DataTypes.ENUM('upcoming_7', 'upcoming_3', 'upcoming_1', 'due_today', 'overdue_1', 'overdue_3', 'overdue_7', 'manual'),
      allowNull: false
    },
    scheduledDate: { type: DataTypes.DATEONLY, allowNull: false },
    sentDate: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.ENUM('pending', 'sent', 'failed', 'cancelled'), allowNull: false, defaultValue: 'pending' },
    channel: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'whatsapp' },
    message: { type: DataTypes.TEXT, allowNull: false },
    response: { type: DataTypes.JSON, allowNull: true }
  }, {
    tableName: 'fee_reminders',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['student_id'] },
      { fields: ['student_fee_id'] },
      { fields: ['installment_id'] },
      { fields: ['reminder_type'] },
      { fields: ['scheduled_date'] },
      { fields: ['status'] }
    ]
  });

  FeeReminder.associate = (models) => {
    FeeReminder.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    FeeReminder.belongsTo(models.StudentFee, { foreignKey: 'student_fee_id', as: 'fee' });
    FeeReminder.belongsTo(models.FeeInstallment, { foreignKey: 'installment_id', as: 'installment' });
  };

  return FeeReminder;
};
