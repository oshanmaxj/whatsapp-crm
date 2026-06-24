module.exports = (sequelize, DataTypes) => {
  const LeadAssignment = sequelize.define('LeadAssignment', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    leadId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    assignedTo: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    assignedBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    note: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  }, {
    tableName: 'lead_assignments',
    timestamps: true,
    createdAt: 'assigned_at',
    updatedAt: 'updated_at',
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['lead_id'] },
      { fields: ['assigned_to'] },
      { fields: ['assigned_by'] }
    ]
  });

  LeadAssignment.associate = (models) => {
    LeadAssignment.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    LeadAssignment.belongsTo(models.User, { foreignKey: 'assigned_to', as: 'assignee' });
    LeadAssignment.belongsTo(models.User, { foreignKey: 'assigned_by', as: 'assigner' });
  };

  return LeadAssignment;
};