module.exports = (sequelize, DataTypes) => {
  const Appointment = sequelize.define('Appointment', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(180), allowNull: false },
    appointmentType: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'Consultation' },
    visibility: {
      type: DataTypes.ENUM('public', 'private'),
      allowNull: false,
      defaultValue: 'private'
    },
    status: {
      type: DataTypes.ENUM('Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'),
      allowNull: false,
      defaultValue: 'Pending'
    },
    appointmentAt: { type: DataTypes.DATE, allowNull: false },
    durationMinutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 30 },
    customerName: { type: DataTypes.STRING(160), allowNull: false },
    customerPhone: { type: DataTypes.STRING(50), allowNull: false },
    customerEmail: { type: DataTypes.STRING(255), allowNull: true },
    assignedAgentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    reminderAt: { type: DataTypes.DATE, allowNull: true },
    confirmationMessage: { type: DataTypes.TEXT, allowNull: true },
    reminderMessage: { type: DataTypes.TEXT, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'appointments',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['status'] }, { fields: ['appointment_at'] }, { fields: ['assigned_agent_id'] }]
  });

  Appointment.associate = (models) => {
    Appointment.belongsTo(models.User, { foreignKey: 'assigned_agent_id', as: 'agent' });
    Appointment.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    Appointment.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    Appointment.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
  };

  return Appointment;
};
