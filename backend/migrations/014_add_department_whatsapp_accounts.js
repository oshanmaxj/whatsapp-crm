async function tableExists(queryInterface, table) {
  return Boolean(await queryInterface.describeTable(table).catch(() => null));
}

async function columnExists(queryInterface, table, column) {
  const definition = await queryInterface.describeTable(table).catch(() => null);
  return Boolean(definition && Object.prototype.hasOwnProperty.call(definition, column));
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const types = Sequelize.DataTypes;

    if (!await tableExists(queryInterface, 'role_whatsapp_accounts')) {
      await queryInterface.createTable('role_whatsapp_accounts', {
        id: {
          type: types.BIGINT,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false
        },
        role_id: {
          type: types.BIGINT,
          allowNull: false,
          references: { model: 'roles', key: 'id' },
          onDelete: 'CASCADE'
        },
        whatsapp_account_id: {
          type: types.BIGINT,
          allowNull: false,
          references: { model: 'whatsapp_accounts', key: 'id' },
          onDelete: 'CASCADE'
        },
        created_at: { type: types.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: types.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('role_whatsapp_accounts', ['whatsapp_account_id'], {
        name: 'role_whatsapp_accounts_whatsapp_account_id_idx'
      });
      await queryInterface.addIndex('role_whatsapp_accounts', ['role_id'], {
        name: 'role_whatsapp_accounts_role_id_idx'
      });
      await queryInterface.addConstraint('role_whatsapp_accounts', {
        fields: ['role_id', 'whatsapp_account_id'],
        type: 'unique',
        name: 'role_whatsapp_accounts_role_account_unique'
      });
    }

    if (await tableExists(queryInterface, 'whatsapp_accounts')) {
      if (!await columnExists(queryInterface, 'whatsapp_accounts', 'connection_status')) {
        await queryInterface.addColumn('whatsapp_accounts', 'connection_status', {
          type: types.STRING(30),
          allowNull: true,
          defaultValue: 'connected'
        });
      }
      if (!await columnExists(queryInterface, 'whatsapp_accounts', 'connection_error')) {
        await queryInterface.addColumn('whatsapp_accounts', 'connection_error', {
          type: types.TEXT,
          allowNull: true
        });
      }

      // Preserve existing installations: departments retain access to the
      // account that previously powered the whole application.
      const [defaults] = await queryInterface.sequelize.query(
        'SELECT id FROM whatsapp_accounts WHERE is_default = true LIMIT 1'
      ).catch(() => [[]]);
      const defaultId = defaults[0]?.id;
      if (defaultId && await tableExists(queryInterface, 'roles')) {
        const [roles] = await queryInterface.sequelize.query('SELECT id FROM roles');
        for (const role of roles) {
          await queryInterface.bulkInsert('role_whatsapp_accounts', [{
            role_id: role.id,
            whatsapp_account_id: defaultId,
            created_at: new Date(),
            updated_at: new Date()
          }], { ignoreDuplicates: true }).catch(() => null);
        }
      }
    }

    if (await tableExists(queryInterface, 'flows') && !await columnExists(queryInterface, 'flows', 'department_id')) {
      await queryInterface.addColumn('flows', 'department_id', {
        type: types.INTEGER.UNSIGNED,
        allowNull: true,
        references: { model: 'roles', key: 'id' },
        onDelete: 'SET NULL'
      });
      await queryInterface.addIndex('flows', ['department_id'], { name: 'flows_department_id_idx' });
    }
  },

  async down(queryInterface) {
    if (await columnExists(queryInterface, 'flows', 'department_id')) {
      await queryInterface.removeColumn('flows', 'department_id');
    }
    if (await columnExists(queryInterface, 'whatsapp_accounts', 'connection_error')) {
      await queryInterface.removeColumn('whatsapp_accounts', 'connection_error');
    }
    if (await columnExists(queryInterface, 'whatsapp_accounts', 'connection_status')) {
      await queryInterface.removeColumn('whatsapp_accounts', 'connection_status');
    }
    if (await tableExists(queryInterface, 'role_whatsapp_accounts')) {
      await queryInterface.dropTable('role_whatsapp_accounts');
    }
  }
};
