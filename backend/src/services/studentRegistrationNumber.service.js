const models = require('../models');

const SEQUENCE_NAME = 'student_registration_number_seq';

function formatStudentRegistrationNumber(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > 999999) {
    throw Object.assign(new Error('Student registration number sequence is outside the six-digit range.'), {
      code: 'STUDENT_NUMBER_SEQUENCE_EXHAUSTED', status: 500
    });
  }
  return `STU-${String(numeric).padStart(6, '0')}`;
}

function createStudentRegistrationNumberService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  return {
    async next({ transaction } = {}) {
      if (!transaction) {
        throw Object.assign(new Error('Student registration number allocation requires a transaction.'), {
          code: 'STUDENT_NUMBER_TRANSACTION_REQUIRED', status: 500
        });
      }
      const [rows] = await sequelize.query(
        `SELECT nextval('${SEQUENCE_NAME}') AS value`,
        { transaction }
      );
      return formatStudentRegistrationNumber(rows[0].value);
    }
  };
}

module.exports = createStudentRegistrationNumberService();
module.exports.createStudentRegistrationNumberService = createStudentRegistrationNumberService;
module.exports.formatStudentRegistrationNumber = formatStudentRegistrationNumber;
