const dotenv = require('dotenv');
dotenv.config();

const validateEnv = require('../config/validateEnv');
const { sequelize } = require('../models');
const userService = require('../services/user.service');

async function run() {
  try {
    validateEnv();
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    await userService.repairAccessDuplicates().catch((error) => {
      console.warn('Access duplicate repair skipped before sync:', error.message || error);
    });

    await sequelize.sync({ alter: true });
    await userService.ensureAccessDefaults();
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
