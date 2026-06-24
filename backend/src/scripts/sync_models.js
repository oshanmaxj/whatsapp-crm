const dotenv = require('dotenv');
dotenv.config();

const validateEnv = require('../config/validateEnv');
const { sequelize } = require('../models');

async function run() {
  try {
    validateEnv();
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    await sequelize.sync({ alter: true });
    console.log('All models synced successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Model sync failed:', error.message || error);
    process.exit(1);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

run();
