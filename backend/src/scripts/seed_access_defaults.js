const dotenv = require('dotenv');
dotenv.config();

const validateEnv = require('../config/validateEnv');
const { sequelize } = require('../models');
const userService = require('../services/user.service');

async function run() {
  try {
    validateEnv();
    await sequelize.authenticate();
    await userService.seedAccessDefaults();
    console.log('Access roles and permissions seeded successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Access seed failed:', error.message || error);
    process.exit(1);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

run();
