const SUPPORTED_STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed'];

async function columnExists(queryInterface, columnName) {
  const definition = await queryInterface.describeTable('messages');
  return Object.prototype.hasOwnProperty.call(definition, columnName);
}

async function up(queryInterface, Sequelize) {
  const dialect = queryInterface.sequelize.getDialect();

  if (!(await columnExists(queryInterface, 'status'))) {
    await queryInterface.addColumn('messages', 'status', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'pending'
    });
  } else if (dialect === 'postgres') {
    // The original schema used a PostgreSQL enum containing queued/received.
    // Convert it explicitly so existing installations can adopt the Phase 1
    // lifecycle without an enum cast failure.
    await queryInterface.sequelize.query(`
      ALTER TABLE "messages"
        ALTER COLUMN "status" DROP DEFAULT,
        ALTER COLUMN "status" TYPE VARCHAR(50)
          USING (
            CASE "status"::text
              WHEN 'queued' THEN 'pending'
              WHEN 'received' THEN 'delivered'
              WHEN 'sent' THEN 'sent'
              WHEN 'delivered' THEN 'delivered'
              WHEN 'read' THEN 'read'
              WHEN 'failed' THEN 'failed'
              ELSE 'pending'
            END
          ),
        ALTER COLUMN "status" SET DEFAULT 'pending',
        ALTER COLUMN "status" SET NOT NULL
    `);
  } else {
    await queryInterface.changeColumn('messages', 'status', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'pending'
    });
    await queryInterface.bulkUpdate('messages', { status: 'pending' }, { status: 'queued' });
    await queryInterface.bulkUpdate('messages', { status: 'delivered' }, { status: 'received' });
  }

  if (!(await columnExists(queryInterface, 'status_updated_at'))) {
    await queryInterface.addColumn('messages', 'status_updated_at', {
      type: Sequelize.DATE,
      allowNull: true
    });
  }

  if (!(await columnExists(queryInterface, 'error_code'))) {
    await queryInterface.addColumn('messages', 'error_code', {
      type: Sequelize.STRING(100),
      allowNull: true
    });
  }

  if (!(await columnExists(queryInterface, 'error_message'))) {
    await queryInterface.addColumn('messages', 'error_message', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  } else {
    await queryInterface.changeColumn('messages', 'error_message', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  }

  await queryInterface.sequelize.query(`
    UPDATE "messages"
    SET "status_updated_at" = COALESCE("status_updated_at", "updated_at", "created_at")
    WHERE "status_updated_at" IS NULL
  `);

  if (dialect === 'postgres') {
    await queryInterface.sequelize.query(`
      ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_status_supported"
    `);
    await queryInterface.addConstraint('messages', {
      fields: ['status'],
      type: 'check',
      name: 'messages_status_supported',
      where: { status: SUPPORTED_STATUSES }
    });
  }
}

async function down(queryInterface, Sequelize) {
  await queryInterface.removeConstraint('messages', 'messages_status_supported').catch(() => {});
  await queryInterface.removeColumn('messages', 'status_updated_at');
  await queryInterface.removeColumn('messages', 'error_code');
  await queryInterface.removeColumn('messages', 'error_message');
  await queryInterface.changeColumn('messages', 'status', {
    type: Sequelize.STRING(50),
    allowNull: false,
    defaultValue: 'queued'
  });
}

module.exports = { up, down, SUPPORTED_STATUSES };
