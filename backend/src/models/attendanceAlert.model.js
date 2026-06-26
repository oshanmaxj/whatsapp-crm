module.exports = (sequelize, DataTypes) => {
  const AttendanceAlert = sequelize.define('AttendanceAlert', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    guardianId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    attendanceRecordId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    alertType: {
      type: DataTypes.ENUM(
        'absent_today',
        'consecutive_absent_2',
        'consecutive_absent_3',
        'attendance_below_75',
        'attendance_below_50',
        'manual'
      ),
      allowNull: false
    },
    scheduledDate: { type: DataTypes.DATEONLY, allowNull: false },
    sentDate: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'failed', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    channel: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'whatsapp' },
    recipientType: {
      type: DataTypes.ENUM('student', 'guardian', 'both'),
      allowNull: false,
      defaultValue: 'both'
    },
    message: { type: DataTypes.TEXT, allowNull: false },
    response: { type: DataTypes.JSON, allowNull: true }
  }, {
    tableName: 'attendance_alerts',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['student_id'] },
      { fields: ['guardian_id'] },
      { fields: ['attendance_record_id'] },
      { fields: ['alert_type'] },
      { fields: ['scheduled_date'] },
      { fields: ['status'] },
      { fields: ['recipient_type'] }
    ]
  });

  AttendanceAlert.associate = (models) => {
    AttendanceAlert.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    AttendanceAlert.belongsTo(models.StudentGuardian, { foreignKey: 'guardian_id', as: 'guardian' });
    AttendanceAlert.belongsTo(models.AttendanceRecord, { foreignKey: 'attendance_record_id', as: 'attendanceRecord' });
  };

  return AttendanceAlert;
};
