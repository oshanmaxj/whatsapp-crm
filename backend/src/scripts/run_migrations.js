const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

async function columnExists(queryInterface, tableName, columnName) {
  const tableDesc = await queryInterface.describeTable(tableName).catch(() => null);
  if (!tableDesc) return false;
  return Object.prototype.hasOwnProperty.call(tableDesc, columnName);
}

async function safeAddColumn(queryInterface, tableName, columnName, definition) {
  const exists = await columnExists(queryInterface, tableName, columnName);
  if (exists) {
    console.log(`Skipping: ${tableName}.${columnName} already exists`);
    return;
  }

  try {
    console.log(`Adding column ${tableName}.${columnName}`);
    await queryInterface.addColumn(tableName, columnName, definition);
    console.log(`Added: ${tableName}.${columnName}`);
  } catch (err) {
    console.error(`Failed to add ${tableName}.${columnName}:`, err.message || err);
  }
}

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  return indexes.some((index) => index.name === indexName);
}

async function safeAddIndex(queryInterface, tableName, fields, options = {}) {
  const indexName = options.name || `${tableName}_${fields.join('_')}_idx`;
  const exists = await indexExists(queryInterface, tableName, indexName);
  if (exists) {
    console.log(`Skipping: index ${indexName} already exists`);
    return;
  }

  try {
    console.log(`Adding index ${indexName}`);
    await queryInterface.addIndex(tableName, fields, { ...options, name: indexName });
    console.log(`Added: index ${indexName}`);
  } catch (err) {
    console.error(`Failed to add index ${indexName}:`, err.message || err);
  }
}

async function run() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected. Running migrations...');

    const queryInterface = sequelize.getQueryInterface();

    // Leads
    await safeAddColumn(queryInterface, 'leads', 'ai_score', { type: DataTypes.INTEGER.UNSIGNED, allowNull: true });
    await safeAddColumn(queryInterface, 'leads', 'qualification_status', { type: DataTypes.STRING(50), allowNull: true });
    await safeAddColumn(queryInterface, 'leads', 'qualification_notes', { type: DataTypes.TEXT, allowNull: true });
    await safeAddColumn(queryInterface, 'leads', 'sentiment', { type: DataTypes.ENUM('positive', 'neutral', 'negative'), allowNull: true });

    // Conversations
    await safeAddColumn(queryInterface, 'conversations', 'summary', { type: DataTypes.TEXT, allowNull: true });
    await safeAddColumn(queryInterface, 'conversations', 'suggested_agent', { type: DataTypes.STRING(255), allowNull: true });

    // Messages
    await safeAddColumn(queryInterface, 'messages', 'sentiment', { type: DataTypes.ENUM('positive', 'neutral', 'negative'), allowNull: true });
    await safeAddColumn(queryInterface, 'messages', 'sentiment_score', { type: DataTypes.DECIMAL(5, 4), allowNull: true });

    // Production hardening indexes
    await safeAddIndex(queryInterface, 'leads', ['owner_id', 'created_at']);
    await safeAddIndex(queryInterface, 'leads', ['status_id', 'created_at']);
    await safeAddIndex(queryInterface, 'leads', ['source_id', 'created_at']);
    await safeAddIndex(queryInterface, 'leads', ['course_interested']);
    await safeAddIndex(queryInterface, 'leads', ['created_at']);
    await safeAddIndex(queryInterface, 'contacts', ['status', 'created_at']);
    await safeAddIndex(queryInterface, 'contacts', ['created_at']);
    await safeAddIndex(queryInterface, 'conversations', ['status', 'updated_at']);
    await safeAddIndex(queryInterface, 'conversations', ['last_message_at']);
    await safeAddIndex(queryInterface, 'conversations', ['updated_at']);
    await safeAddIndex(queryInterface, 'messages', ['conversation_id', 'created_at']);
    await safeAddIndex(queryInterface, 'messages', ['conversation_id', 'is_read']);
    await safeAddIndex(queryInterface, 'messages', ['created_at']);
    await safeAddIndex(queryInterface, 'message_queue', ['status', 'scheduled_at', 'priority']);
    await safeAddIndex(queryInterface, 'message_queue', ['status', 'next_attempt_at']);
    await safeAddIndex(queryInterface, 'user_roles', ['user_id']);
    await safeAddIndex(queryInterface, 'user_roles', ['role_id']);
    await safeAddIndex(queryInterface, 'role_permissions', ['role_id']);
    await safeAddIndex(queryInterface, 'role_permissions', ['permission_id']);

    console.log('Migrations complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration runner failed:', err);
    process.exit(1);
  }
}

run();
