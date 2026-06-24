const logger = require('./logger');

const requiredEnvKeys = [
  'DB_DIALECT',
  'FRONTEND_URL',
  'NODE_ENV'
];

const optionalFeatureKeys = [
  'OPENAI_API_KEY',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN'
];

function validateEnv() {
  const missingKeys = requiredEnvKeys.filter((key) => !process.env[key] || String(process.env[key]).trim() === '');
  if (missingKeys.length) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(', ')}. ` +
        'Fill them in backend/.env or your deployment environment before starting the server.'
    );
  }

  const dialect = process.env.DB_DIALECT.trim().toLowerCase();
  if (!['postgres', 'mysql', 'sqlite'].includes(dialect)) {
    throw new Error(`Unsupported DB_DIALECT '${process.env.DB_DIALECT}'. Use 'postgres' for local PostgreSQL.`);
  }

  if (dialect === 'postgres' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when DB_DIALECT is postgres.');
  }

  if (dialect === 'postgres' && !/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL)) {
    throw new Error(`DATABASE_URL must be a valid PostgreSQL URI starting with 'postgres://' or 'postgresql://'.`);
  }

  const disabledFeatures = optionalFeatureKeys.filter((key) => !process.env[key] || String(process.env[key]).trim() === '');
  if (disabledFeatures.length) {
    logger.warn('optional_integrations_disabled', { keys: disabledFeatures });
  }

  if (process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL.includes('localhost')) {
    logger.warn('production_frontend_url_is_localhost');
  }

  if (process.env.NODE_ENV === 'production') {
    ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'].forEach((key) => {
      if (!process.env[key] || process.env[key].includes('jwt_')) {
        throw new Error(`${key} must be set to a strong production secret.`);
      }
    });
  }
}

module.exports = validateEnv;
