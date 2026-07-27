require('../config/loadEnv');
const sequelize = require('../config/database');
const migration = require('../../migrations/052_call_queue_phase1');

async function run() {
  try {
    await sequelize.authenticate();
    const report = await migration.preflight(sequelize.getQueryInterface());
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
  } catch (error) {
    console.error('Migration 052 read-only preflight failed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

run();
