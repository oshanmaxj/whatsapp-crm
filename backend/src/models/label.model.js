module.exports = (sequelize, DataTypes) => {
  const Label = sequelize.define('Label', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: {
      type: DataTypes.STRING(100), allowNull: false, unique: true,
      set(value) { this.setDataValue('name', String(value || '').trim().replace(/\s+/g, ' ')); }
    },
    color: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '#25d366' }
  }, {
    tableName: 'labels',
    timestamps: true,
    underscored: true
  });

  return Label;
};
