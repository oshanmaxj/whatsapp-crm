async function tableExists(queryInterface, table) {
  return Boolean(await queryInterface.describeTable(table).catch(() => null));
}

async function columnExists(queryInterface, table, column) {
  const definition = await queryInterface.describeTable(table).catch(() => null);
  return Boolean(definition && Object.prototype.hasOwnProperty.call(definition, column));
}

async function indexExists(queryInterface, table, name) {
  const indexes = await queryInterface.showIndex(table).catch(() => []);
  return indexes.some((index) => index.name === name);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const types = Sequelize.DataTypes;

    if (!await tableExists(queryInterface, 'whatsapp_accounts')) return;

    // Keep the exact PostgreSQL repair independently runnable. Other supported
    // dialects use the equivalent query-interface operation.
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE whatsapp_accounts
        ADD COLUMN IF NOT EXISTS connection_status VARCHAR(50) DEFAULT 'connected';

        ALTER TABLE whatsapp_accounts
        ALTER COLUMN connection_status TYPE VARCHAR(50),
        ALTER COLUMN connection_status SET DEFAULT 'connected'
      `);
    } else if (!await columnExists(queryInterface, 'whatsapp_accounts', 'connection_status')) {
      await queryInterface.addColumn('whatsapp_accounts', 'connection_status', {
        type: types.STRING(50),
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
    await queryInterface.sequelize.query(dialect === 'postgres' ? `
      UPDATE whatsapp_accounts
      SET connection_status = COALESCE(status::text, 'connected')
      WHERE connection_status IS NULL
    ` : `
      UPDATE whatsapp_accounts
      SET connection_status = COALESCE(CAST(status AS CHAR), 'connected')
      WHERE connection_status IS NULL
    `);

    if (!await tableExists(queryInterface, 'role_whatsapp_accounts')) {
      await queryInterface.createTable('role_whatsapp_accounts', {
        id: { type: types.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
        role_id: { type: types.BIGINT, allowNull: false },
        whatsapp_account_id: { type: types.BIGINT, allowNull: false },
        created_at: { type: types.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: types.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    } else {
      if (!await columnExists(queryInterface, 'role_whatsapp_accounts', 'id')) {
        await queryInterface.addColumn('role_whatsapp_accounts', 'id', {
          type: types.BIGINT,
          autoIncrement: true,
          allowNull: true
        });
      }
      if (!await columnExists(queryInterface, 'role_whatsapp_accounts', 'role_id')) {
        await queryInterface.addColumn('role_whatsapp_accounts', 'role_id', { type: types.BIGINT, allowNull: true });
      }
      if (!await columnExists(queryInterface, 'role_whatsapp_accounts', 'whatsapp_account_id')) {
        await queryInterface.addColumn('role_whatsapp_accounts', 'whatsapp_account_id', { type: types.BIGINT, allowNull: true });
      }
      if (!await columnExists(queryInterface, 'role_whatsapp_accounts', 'created_at')) {
        await queryInterface.addColumn('role_whatsapp_accounts', 'created_at', {
          type: types.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        });
      }
      if (!await columnExists(queryInterface, 'role_whatsapp_accounts', 'updated_at')) {
        await queryInterface.addColumn('role_whatsapp_accounts', 'updated_at', {
          type: types.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        });
      }
    }

    if (dialect === 'postgres') {
      // Upgrade the earlier composite-primary-key version without losing rows.
      await queryInterface.sequelize.query(`
        DO $$
        DECLARE current_pk text;
        BEGIN
          ALTER TABLE role_whatsapp_accounts
            ALTER COLUMN role_id SET NOT NULL,
            ALTER COLUMN whatsapp_account_id SET NOT NULL;

          SELECT conname INTO current_pk
          FROM pg_constraint
          WHERE conrelid = 'role_whatsapp_accounts'::regclass
            AND contype = 'p';

          IF current_pk IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_attribute a
              ON a.attrelid = c.conrelid
             AND a.attnum = ANY(c.conkey)
            WHERE c.conrelid = 'role_whatsapp_accounts'::regclass
              AND c.contype = 'p'
              AND a.attname = 'id'
          ) THEN
            EXECUTE format('ALTER TABLE role_whatsapp_accounts DROP CONSTRAINT %I', current_pk);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'role_whatsapp_accounts'::regclass
              AND contype = 'p'
          ) THEN
            ALTER TABLE role_whatsapp_accounts
              ALTER COLUMN id SET NOT NULL,
              ADD CONSTRAINT role_whatsapp_accounts_pkey PRIMARY KEY (id);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'role_whatsapp_accounts'::regclass
              AND conname = 'role_whatsapp_accounts_role_account_unique'
          ) THEN
            ALTER TABLE role_whatsapp_accounts
              ADD CONSTRAINT role_whatsapp_accounts_role_account_unique
              UNIQUE (role_id, whatsapp_account_id);
          END IF;
        END $$;
      `);
    } else {
      const indexes = await queryInterface.showIndex('role_whatsapp_accounts').catch(() => []);
      const hasUniquePair = indexes.some((index) => index.unique
        && (index.fields || []).map((field) => field.attribute || field.name).join(',')
          === 'role_id,whatsapp_account_id');
      if (!hasUniquePair) {
        await queryInterface.addConstraint('role_whatsapp_accounts', {
          fields: ['role_id', 'whatsapp_account_id'],
          type: 'unique',
          name: 'role_whatsapp_accounts_role_account_unique'
        });
      }
    }

    if (!await indexExists(queryInterface, 'role_whatsapp_accounts', 'role_whatsapp_accounts_role_id_idx')) {
      await queryInterface.addIndex('role_whatsapp_accounts', ['role_id'], {
        name: 'role_whatsapp_accounts_role_id_idx'
      });
    }
    if (!await indexExists(queryInterface, 'role_whatsapp_accounts', 'role_whatsapp_accounts_whatsapp_account_id_idx')) {
      await queryInterface.addIndex('role_whatsapp_accounts', ['whatsapp_account_id'], {
        name: 'role_whatsapp_accounts_whatsapp_account_id_idx'
      });
    }

    const [defaults] = await queryInterface.sequelize.query(
      'SELECT id FROM whatsapp_accounts WHERE is_default = true ORDER BY id LIMIT 1'
    ).catch(() => [[]]);
    const defaultId = defaults[0]?.id;
    if (defaultId && await tableExists(queryInterface, 'roles')) {
      if (dialect === 'postgres') {
        await queryInterface.sequelize.query(`
          INSERT INTO role_whatsapp_accounts
            (role_id, whatsapp_account_id, created_at, updated_at)
          SELECT id, :defaultId, NOW(), NOW()
          FROM roles
          ON CONFLICT (role_id, whatsapp_account_id) DO NOTHING
        `, { replacements: { defaultId } });
      } else {
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
  },

  async down() {
    // Deliberately non-destructive: this is a production schema repair.
  }
};
