async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => {
    const name = typeof table === 'string'
      ? table
      : table.tableName || table.table_name || table.name;
    return String(name).toLowerCase() === tableName.toLowerCase();
  });
}

async function ensureIndex(queryInterface, fields, name) {
  const indexes = await queryInterface.showIndex('birthday_wishes');
  if (indexes.some((index) => index.name === name)) return;
  await queryInterface.addIndex('birthday_wishes', fields, { name });
}

async function up(queryInterface, Sequelize) {
  const exists = await tableExists(queryInterface, 'birthday_wishes');
  if (!exists) {
    await queryInterface.createTable('birthday_wishes', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      student_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      guardian_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: { model: 'student_guardians', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      recipient_type: {
        type: Sequelize.ENUM('student', 'guardian'),
        allowNull: false
      },
      birthday_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      sent_date: {
        type: Sequelize.DATE,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('pending', 'sent', 'failed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending'
      },
      channel: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'whatsapp'
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      response: {
        type: Sequelize.JSON,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  }

  await ensureIndex(queryInterface, ['student_id'], 'birthday_wishes_student_id');
  await ensureIndex(queryInterface, ['guardian_id'], 'birthday_wishes_guardian_id');
  await ensureIndex(queryInterface, ['recipient_type'], 'birthday_wishes_recipient_type');
  await ensureIndex(queryInterface, ['birthday_date'], 'birthday_wishes_birthday_date');
  await ensureIndex(queryInterface, ['status'], 'birthday_wishes_status');

  return !exists;
}

async function down(queryInterface) {
  await queryInterface.dropTable('birthday_wishes');
}

module.exports = { up, down };
