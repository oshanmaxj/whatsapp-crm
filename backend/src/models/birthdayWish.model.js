module.exports = (sequelize, DataTypes) => {
  const BirthdayWish = sequelize.define('BirthdayWish', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    guardianId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    recipientType: {
      type: DataTypes.ENUM('student', 'guardian'),
      allowNull: false
    },
    birthdayDate: { type: DataTypes.DATEONLY, allowNull: false },
    sentDate: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'failed', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    channel: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'whatsapp' },
    message: { type: DataTypes.TEXT, allowNull: false },
    response: { type: DataTypes.JSON, allowNull: true }
  }, {
    tableName: 'birthday_wishes',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['student_id'] },
      { fields: ['guardian_id'] },
      { fields: ['recipient_type'] },
      { fields: ['birthday_date'] },
      { fields: ['status'] }
    ]
  });

  BirthdayWish.associate = (models) => {
    BirthdayWish.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    BirthdayWish.belongsTo(models.StudentGuardian, { foreignKey: 'guardian_id', as: 'guardian' });
  };

  return BirthdayWish;
};
