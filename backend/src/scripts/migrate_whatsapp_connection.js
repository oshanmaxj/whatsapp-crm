require('dotenv').config();

const Sequelize = require('sequelize');
const sequelize = require('../config/database');
const migration = require('../../migrations/037_whatsapp_connection_verification');

async function run() {
  try {
    await sequelize.authenticate();
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    console.log('Applied: WhatsApp connection verification');
    await sequelize.close();
  } catch (error) {
    console.error('WhatsApp connection migration failed:', error.message);
    await sequelize.close().catch(() => null);
    process.exitCode = 1;
  }
}

run();
