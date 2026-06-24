const { Sequelize } = require('sequelize');
const logger = require('./logger');

const userDialect = (process.env.DB_DIALECT || '').toLowerCase();
const databaseUrl = process.env.DATABASE_URL || null;
const dbName = process.env.DB_NAME || 'whatsapp_crm';
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || '';
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || (userDialect === 'postgres' ? 5432 : 3306);

const autoDialect = databaseUrl?.startsWith('postgres') || databaseUrl?.startsWith('postgresql')
  ? 'postgres'
  : databaseUrl?.startsWith('mysql')
  ? 'mysql'
  : databaseUrl?.startsWith('sqlite')
  ? 'sqlite'
  : null;

const dialect = userDialect || autoDialect || 'postgres';

function isLocalPostgresHost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(hostname || '').toLowerCase());
}

function getDatabaseUrlHostname(url) {
  if (!url) return null;

  try {
    return new URL(url).hostname;
  } catch (error) {
    return null;
  }
}

const pool = {
  max: Number(process.env.DB_POOL_MAX || 20),
  min: Number(process.env.DB_POOL_MIN || 2),
  acquire: Number(process.env.DB_POOL_ACQUIRE || 60000),
  idle: Number(process.env.DB_POOL_IDLE || 10000),
  evict: Number(process.env.DB_POOL_EVICT || 15000)
};

const sequelizeOptions = {
  dialect,
  logging: process.env.NODE_ENV === 'production' ? false : (message) => logger.debug('sequelize_query', { message }),
  pool,
  retry: {
    max: 3
  }
};

if (dialect === 'postgres') {
  const urlHostname = getDatabaseUrlHostname(databaseUrl);
  const postgresHost = urlHostname || dbHost;
  const explicitSsl = process.env.DB_SSL;
  const sslEnabled = explicitSsl
    ? explicitSsl === 'true'
    : !isLocalPostgresHost(postgresHost);

  sequelizeOptions.dialectOptions = {
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT || 10000)
  };

  if (sslEnabled) {
    sequelizeOptions.dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
    };
  }
}

let sequelize;

if (process.env.DB_DIALECT === 'sqlite' || dialect === 'sqlite') {
  const storage = process.env.DB_STORAGE || 'database.sqlite';
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage,
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
} else if (databaseUrl) {
  sequelize = new Sequelize(databaseUrl, sequelizeOptions);
} else {
  sequelize = new Sequelize(dbName, dbUser, dbPassword, {
    host: dbHost,
    port: dbPort,
    ...sequelizeOptions
  });
}

module.exports = sequelize;
