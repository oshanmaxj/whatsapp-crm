module.exports = (sequelize, DataTypes) => {
  const StudentGuardian = sequelize.define('StudentGuardian', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    name: { type: DataTypes.STRING(180), allowNull: false },
    relationship: { type: DataTypes.STRING(80), allowNull: false },
    phone: { type: DataTypes.STRING(50), allowNull: true },
    whatsapp: { type: DataTypes.STRING(50), allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: true },
    isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isEmergencyContact: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    address: { type: DataTypes.TEXT, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'student_guardians',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['student_id'] },
      { fields: ['is_primary'] },
      { fields: ['is_emergency_contact'] }
    ]
  });

  StudentGuardian.associate = (models) => {
    StudentGuardian.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    StudentGuardian.hasMany(models.AttendanceAlert, { foreignKey: 'guardian_id', as: 'attendanceAlerts' });
  };

  return StudentGuardian;
};
