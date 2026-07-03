async function columnExists(queryInterface, table, column) {
  const definition = await queryInterface.describeTable(table).catch(() => null);
  return Boolean(definition && Object.prototype.hasOwnProperty.call(definition, column));
}

async function addColumn(queryInterface, table, column, definition) {
  if (!await columnExists(queryInterface, table, column)) {
    await queryInterface.addColumn(table, column, definition);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(`
        ALTER TABLE "flows" ALTER COLUMN "status" DROP DEFAULT;
        ALTER TABLE "flows" ALTER COLUMN "status" TYPE VARCHAR(30)
          USING CASE WHEN "status"::text = 'paused' THEN 'inactive' ELSE "status"::text END;
        ALTER TABLE "flows" ALTER COLUMN "status" SET DEFAULT 'draft';
        ALTER TABLE "flow_runs" ALTER COLUMN "status" DROP DEFAULT;
        ALTER TABLE "flow_runs" ALTER COLUMN "status" TYPE VARCHAR(30) USING "status"::text;
        ALTER TABLE "flow_runs" ALTER COLUMN "status" SET DEFAULT 'running';
      `);
    } else {
      await queryInterface.changeColumn('flows', 'status', {
        type: Sequelize.DataTypes.STRING(30), allowNull: false, defaultValue: 'draft'
      });
      await queryInterface.changeColumn('flow_runs', 'status', {
        type: Sequelize.DataTypes.STRING(30), allowNull: false, defaultValue: 'running'
      });
    }
    const jsonType = dialect === 'postgres' ? Sequelize.DataTypes.JSONB : Sequelize.DataTypes.JSON;
    await addColumn(queryInterface, 'flows', 'trigger_config', {
      type: jsonType, allowNull: false, defaultValue: {}
    });
    await addColumn(queryInterface, 'flows', 'whatsapp_phone_number_id', {
      type: Sequelize.DataTypes.STRING(100), allowNull: true
    });
    await addColumn(queryInterface, 'flow_nodes', 'stats', {
      type: jsonType, allowNull: false,
      defaultValue: { sent: 0, delivered: 0, read: 0, subscribers: 0, errors: 0 }
    });
    await addColumn(queryInterface, 'flow_connections', 'condition', {
      type: jsonType, allowNull: false, defaultValue: {}
    });
    await addColumn(queryInterface, 'flow_runs', 'conversation_id', {
      type: Sequelize.DataTypes.BIGINT, allowNull: true
    });
    await addColumn(queryInterface, 'flow_runs', 'waiting_for_reply', {
      type: Sequelize.DataTypes.BOOLEAN, allowNull: false, defaultValue: false
    });
    await addColumn(queryInterface, 'flow_runs', 'waiting_node_key', {
      type: Sequelize.DataTypes.STRING(120), allowNull: true
    });
    await addColumn(queryInterface, 'flow_runs', 'last_whatsapp_message_id', {
      type: Sequelize.DataTypes.STRING(255), allowNull: true
    });
    await addColumn(queryInterface, 'flow_run_logs', 'event_type', {
      type: Sequelize.DataTypes.STRING(60), allowNull: true
    });
  },
  async down(queryInterface) {
    for (const [table, column] of [
      ['flow_run_logs', 'event_type'],
      ['flow_runs', 'last_whatsapp_message_id'],
      ['flow_runs', 'waiting_node_key'],
      ['flow_runs', 'waiting_for_reply'],
      ['flow_runs', 'conversation_id'],
      ['flow_connections', 'condition'],
      ['flow_nodes', 'stats'],
      ['flows', 'whatsapp_phone_number_id'],
      ['flows', 'trigger_config']
    ]) {
      if (await columnExists(queryInterface, table, column)) await queryInterface.removeColumn(table, column);
    }
  }
};
