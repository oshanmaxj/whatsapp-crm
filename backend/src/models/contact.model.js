module.exports = (sequelize, DataTypes) => {
  const Contact = sequelize.define('Contact', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    firstName: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    lastName: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    whatsappId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    company: {
      type: DataTypes.STRING(150),
      allowNull: true
    },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: []
    },
    status: {
      type: DataTypes.ENUM('new', 'active', 'inactive', 'archived'),
      allowNull: false,
      defaultValue: 'new'
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'contacts',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['phone'] },
      { fields: ['whatsapp_id'] },
      { fields: ['status'] },
      { fields: ['status', 'created_at'] },
      { fields: ['created_at'] }
    ]
  });

  return Contact;
};
