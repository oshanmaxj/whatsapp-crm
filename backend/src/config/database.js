require('./loadEnv');
const { Sequelize } = require('sequelize');
const logger = require('./logger');
const { resolveDatabaseConfig } = require('./databaseConfig');

const resolved = resolveDatabaseConfig(process.env);
const dbName = process.env.DB_NAME || 'whatsapp_crm';
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || '';

const pool = {
  max: Number(process.env.DB_POOL_MAX || 20),
  min: Number(process.env.DB_POOL_MIN || 2),
  acquire: Number(process.env.DB_POOL_ACQUIRE || 60000),
  idle: Number(process.env.DB_POOL_IDLE || 10000),
  evict: Number(process.env.DB_POOL_EVICT || 15000)
};

const sequelizeOptions = {
  dialect: resolved.dialect,
  host: resolved.host,
  port: resolved.port,
  logging: process.env.NODE_ENV === 'production' ? false : (message) => logger.debug('sequelize_query', { message }),
  pool,
  retry: { max: 3 }
};

if (resolved.dialect === 'postgres') {
  sequelizeOptions.dialectOptions = {
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT || 10000)
  };
  if (resolved.sslEnabled) {
    sequelizeOptions.dialectOptions.ssl = {
      require: true,
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
    };
  }
}

let sequelize;
if (resolved.dialect === 'sqlite') {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.DB_STORAGE || 'database.sqlite',
    logging: false,
    pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
  });
} else {
  const parsedUrl = resolved.databaseUrl ? new URL(resolved.databaseUrl) : null;
  const database = parsedUrl ? decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '')) : dbName;
  const username = parsedUrl ? decodeURIComponent(parsedUrl.username) : dbUser;
  const password = parsedUrl ? decodeURIComponent(parsedUrl.password) : dbPassword;
  if (!database) throw new Error('Database name is required.');
  sequelize = new Sequelize(database, username, password, sequelizeOptions);
}

sequelize.resolvedConfig = Object.freeze({
  dialect: resolved.dialect,
  host: resolved.host,
  port: resolved.port,
  sslEnabled: resolved.sslEnabled
});

module.exports = sequelize;
