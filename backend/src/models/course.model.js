module.exports = (sequelize, DataTypes) => {
  const Course = sequelize.define('Course', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(160), allowNull: false },
    code: { type: DataTypes.STRING(40), allowNull: true, unique: true },
    category: { type: DataTypes.STRING(100), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    shortDescription: { type: DataTypes.STRING(500), allowNull: true },
    thumbnailUrl: { type: DataTypes.TEXT, allowNull: true },
    introVideoUrl: { type: DataTypes.TEXT, allowNull: true },
    instructorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    difficultyLevel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'beginner' },
    durationMinutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    lmsStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
    visibility: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'enrolled' },
    enrollmentStartAt: { type: DataTypes.DATE, allowNull: true },
    enrollmentEndAt: { type: DataTypes.DATE, allowNull: true },
    expiresAfterDays: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    lifetimeAccess: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    dripEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    defaultDripType: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'immediate' },
    certificateEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    completionPercentageRequired: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 100 },
    allowLessonDownloads: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    allowComments: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    courseOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    durationWeeks: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    feeAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    whatsappGroupLink: { type: DataTypes.STRING(500), allowNull: true },
    whatsappGroupName: { type: DataTypes.STRING(180), allowNull: true },
    defaultInstallmentCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1, validate: { min: 1 } },
    status: { type: DataTypes.ENUM('active', 'inactive', 'archived'), allowNull: false, defaultValue: 'active' }
  }, {
    tableName: 'courses',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['status'] }, { fields: ['name'] }]
  });

  Course.associate = (models) => {
    Course.belongsTo(models.User, { foreignKey: 'instructor_id', as: 'instructor' });
  };

  return Course;
};
