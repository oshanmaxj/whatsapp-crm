module.exports = (sequelize, DataTypes) => {
  const Lead = sequelize.define('Lead', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    contactId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    ownerId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    statusId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    sourceId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true
    },
    priority: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
      allowNull: false,
      defaultValue: 'medium'
    },
    value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    courseInterested: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    batchInterested: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    budget: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true
    },
    studentType: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    customFields: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    stage: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'new'
    },
    aiScore: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true
    },
    qualificationStatus: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    qualificationNotes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    sentiment: {
      type: DataTypes.ENUM('positive', 'neutral', 'negative'),
      allowNull: true
    },
    nextFollowupAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastFollowupAt:{type:DataTypes.DATE,allowNull:true},followupStatus:{type:DataTypes.STRING(30),allowNull:true},lostReasonId:{type:DataTypes.INTEGER.UNSIGNED,allowNull:true},lostReasonText:{type:DataTypes.TEXT,allowNull:true},convertedAt:{type:DataTypes.DATE,allowNull:true},convertedByUserId:{type:DataTypes.BIGINT.UNSIGNED,allowNull:true},
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'leads',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['contact_id'] },
      { fields: ['owner_id'] },
      { fields: ['status_id'] },
      { fields: ['source_id'] },
      { fields: ['owner_id', 'created_at'] },
      { fields: ['status_id', 'created_at'] },
      { fields: ['source_id', 'created_at'] },
      { fields: ['course_interested'] },
      { fields: ['created_at'] }
      ,{ fields: ['updated_at'] }
    ]
  });

  Lead.associate = (models) => {
    Lead.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    Lead.belongsTo(models.User, { foreignKey: 'owner_id', as: 'owner' });
    Lead.belongsTo(models.LeadStatus, { foreignKey: 'status_id', as: 'status' });
    Lead.belongsTo(models.LeadSource, { foreignKey: 'source_id', as: 'source' });
  };

  return Lead;
};
