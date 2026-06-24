module.exports = (sequelize, DataTypes) => {
  const AppointmentRequest = sequelize.define('AppointmentRequest', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    appointmentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    appointmentType: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'Consultation' },
    customerName: { type: DataTypes.STRING(160), allowNull: false },
    customerPhone: { type: DataTypes.STRING(50), allowNull: false },
    customerEmail: { type: DataTypes.STRING(255), allowNull: true },
    requestedAt: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('Pending', 'Approved', 'Rejected', 'Converted'),
      allowNull: false,
      defaultValue: 'Pending'
    },
    notes: { type: DataTypes.TEXT, allowNull: true },
    source: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Manual Entry' }
  }, {
    tableName: 'appointment_requests',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['status'] }, { fields: ['requested_at'] }]
  });

  AppointmentRequest.associate = (models) => {
    AppointmentRequest.belongsTo(models.Appointment, { foreignKey: 'appointment_id', as: 'appointment' });
  };

  return AppointmentRequest;
};
