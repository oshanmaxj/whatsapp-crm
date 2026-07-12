const dotenv = require('dotenv');
dotenv.config();

const validateEnv = require('./config/validateEnv');
validateEnv();

const http = require('http');
const app = require('./app');
const logger = require('./config/logger');
const initSocket = require('./sockets/socket');
const { sequelize } = require('./models');
const messageQueueService = require('./services/messageQueue.service');
const automationService = require('./services/automation.service');
const flowService = require('./services/flow.service');
const pipelineService = require('./services/pipeline.service');
const { isMissingTableError } = require('./utils/databaseError');

const PORT = process.env.PORT || 4000;

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', error);
  process.exit(1);
});

const startServer = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.getQueryInterface().describeTable('birthday_wishes').catch((error) => {
      if (!isMissingTableError(error, 'birthday_wishes')) throw error;
      logger.warn('birthday_wishes_table_missing', {
        action: 'Run npm run migrate from the backend directory'
      });
    });
    if (process.env.DB_SYNC_ALTER === 'true') {
      await sequelize.sync({ alter: true });
      logger.warn('sequelize_sync_alter_enabled');
    }
    await automationService.ensureDefaults();
    logger.info('database_connection_established');

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
      logger.info('server_started', { port: PORT });
    });
    messageQueueService.start();
    flowService.start();
    pipelineService.start();
  } catch (error) {
    logger.error('server_start_failed', error);
    process.exit(1);
  }
};

startServer();
