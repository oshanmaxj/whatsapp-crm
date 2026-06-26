const dotenv = require('dotenv');
dotenv.config();

const {
  AttendanceRecord,
  Batch,
  Campaign,
  Course,
  FeeInstallment,
  Lead,
  sequelize,
  Student,
  StudentFee,
  User
} = require('../models');
const reportService = require('../services/report.service');

async function run() {
  try {
    await sequelize.authenticate();
    const counts = {};
    for (const [name, model] of Object.entries({
      Course,
      Batch,
      Student,
      Lead,
      User,
      StudentFee,
      FeeInstallment,
      Campaign,
      AttendanceRecord
    })) {
      counts[name] = await model.count();
    }

    const options = await reportService.options();
    const students = await reportService.report('students', {});
    const leads = await reportService.report('leads', {});

    console.log(JSON.stringify({
      counts,
      options: {
        courses: options.courses.length,
        batches: options.batches.length,
        agents: options.agents.length
      },
      reports: {
        students: students.rows.length,
        leads: leads.rows.length
      }
    }, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Reports smoke test failed:', error);
    process.exit(1);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

run();
