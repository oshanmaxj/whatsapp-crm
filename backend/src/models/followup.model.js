module.exports = (sequelize, DataTypes) => {
  const Followup = sequelize.define('Followup', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    leadId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    contactId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    conversationId:{type:DataTypes.BIGINT.UNSIGNED,allowNull:true},createdByUserId:{type:DataTypes.BIGINT.UNSIGNED,allowNull:true},followupType:{type:DataTypes.STRING(30),allowNull:false,defaultValue:'general'},outcome:{type:DataTypes.TEXT,allowNull:true},completedByUserId:{type:DataTypes.BIGINT.UNSIGNED,allowNull:true},rescheduledFromId:{type:DataTypes.BIGINT.UNSIGNED,allowNull:true},
    assignedTo: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: false
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'pending'
    },
    priority: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'medium'
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'followups',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['lead_id'] },
      { fields: ['contact_id'] },
      { fields: ['assigned_to'] },
      { fields: ['due_date'] }
    ]
  });

  Followup.associate = (models) => {
    Followup.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    Followup.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    Followup.belongsTo(models.User, { foreignKey: 'assigned_to', as: 'assignee' });
  };

  return Followup;
};
