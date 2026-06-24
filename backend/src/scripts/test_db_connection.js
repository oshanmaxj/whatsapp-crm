const dotenv = require('dotenv');
dotenv.config();

const validateEnv = require('../config/validateEnv');
const { sequelize } = require('../models');

async function run() {
  try {
    validateEnv();
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    console.log(`Dialect: ${sequelize.getDialect()}`);
    console.log(`Database: ${sequelize.config.database}`);
    console.log(`Host: ${sequelize.config.host || 'from DATABASE_URL'}`);
    process.exit(0);
  } catch (error) {
    console.error('Database connection failed:', error.message || error);
    process.exit(1);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

run();
