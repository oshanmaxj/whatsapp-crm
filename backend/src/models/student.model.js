const bcrypt = require('bcrypt');

module.exports = (sequelize, DataTypes) => {
  const Student = sequelize.define('Student', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentNo: { type: DataTypes.STRING(60), allowNull: false, unique: true },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    phone: { type: DataTypes.STRING(50), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: true },
    dateOfBirth: { type: DataTypes.DATEONLY, allowNull: true },
    status: { type: DataTypes.ENUM('enrolled', 'active', 'completed', 'dropped', 'suspended'), allowNull: false, defaultValue: 'enrolled' },
    enrolledAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    notes: { type: DataTypes.TEXT, allowNull: true },
    portalPasswordHash: { type: DataTypes.STRING(255), allowNull: true }
    , convertedByUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
    , creditedToUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
    , convertedAt: { type: DataTypes.DATE, allowNull: true }
    , conversionOverrideReason: { type: DataTypes.TEXT, allowNull: true }
    , conversionOverriddenByUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'students',
    defaultScope: { attributes: { exclude: ['portalPasswordHash'] } },
    scopes: { withPortalPassword: { attributes: { include: ['portalPasswordHash'] } } },
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['contact_id'] }, { fields: ['lead_id'] }, { fields: ['course_id'] }, { fields: ['batch_id'] }, { fields: ['status'] }],
    hooks: {
      beforeSave: async (student) => {
        if (student.changed('portalPasswordHash') && student.portalPasswordHash) {
          if (!String(student.portalPasswordHash).startsWith('$2')) {
            student.portalPasswordHash = await bcrypt.hash(student.portalPasswordHash, 10);
          }
        }
      }
    }
  });

  Student.associate = (models) => {
    Student.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    Student.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    Student.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    Student.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
  };

  Student.prototype.verifyPortalPassword = function (password) {
    return this.portalPasswordHash ? bcrypt.compare(password, this.portalPasswordHash) : false;
  };

  return Student;
};
